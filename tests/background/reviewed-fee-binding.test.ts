/**
 * MCW-V09-119: the fee a user reviewed must reach the submission that spends it.
 *
 * The enforcement itself lives at the submit boundary and is pinned in
 * tests/starknet/rpc-submit-fee-bounds.test.ts. What is pinned HERE is the
 * wiring, because that is where the finding actually stayed open: a ceiling
 * parameter exists, refuses correctly when it is set, and binds nothing at all
 * if no caller ever sets it. So each case drives a real message through the
 * background and asserts on the input the RPC layer was handed — the reviewed
 * figure present when a fee was shown, and absent when none was.
 *
 * One path per surface that shows a fee and then submits: the dapp invoke
 * approval (which holds the figure itself), and the panel journeys that review
 * in one message and send in another (ERC20 send, NFT send, multisig confirm),
 * which echo it back. The multisig case lives with its own harness in
 * tests/background/background-multisig-confirm-execute.test.ts, and the dapp
 * declare case in tests/background/background-declare-messages.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { InvokeInput, TransferInput } from "@bramble/starknet/rpc";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { testExtension } from "../support/background-wallet-stub";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../support/held";
import {
  invokeAccount as account,
  invokeContentSender as contentSender,
  invokeExtensionSender as extensionSender,
  fixedInvokePreferences as fixedPreferencesStore,
  invokeMessage,
  makeInvokeHarness as makeHarness,
  invokeVaultPassphrase as vaultPassphrase,
  invokeWalletStub as walletStub,
} from "../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../support/runtime-rpc-stub";

// The figure the shared RPC stub's estimator returns, and therefore the exact
// figure every review in this file displays.
const REVIEWED = { overallFee: "1", unit: "FRI" } as const;
const DEPLOYMENT_REVIEWED = { overallFee: "2", unit: "FRI" } as const;
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const RECIPIENT = "0x0511a2b3c4d5e6f7";

// What an approval whose fee moved between paint and click is refused with.
const MOVED_FEE_REFUSAL = "the fee changed since this request was reviewed";
const FEE_REVIEW_REQUIRED = {
  error: "retry the fee estimate before approving this transaction",
};

type Handler = ReturnType<typeof makeHarness>["handler"];

// The fee the approval card would be painting right now. Read from the same
// pending-approvals snapshot the panel renders from, so a test echoes what a
// user would have seen rather than a figure written into the test.
const paintedFee = async (
  handler: Handler,
  id: string,
): Promise<FeeEstimate | null | undefined> => {
  const pending = await waitForPendingApprovals<{
    readonly fee?: FeeEstimate | null;
    readonly id: string;
  }>(handler, extensionSender);
  return pending.find((approval) => approval.id === id)?.fee;
};

describe("dapp invoke approval carries its reviewed fee into submission", () => {
  test("submits under the figure the approval card was showing", async () => {
    const { handler, invoked } = makeHarness();
    const held = handler(invokeMessage(), contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    // Let the queued estimate land, so the card is showing a fee rather than
    // "estimating…" when the approval is applied.
    await flushHeld();
    await flushHeld();
    const painted = await paintedFee(handler, id);
    expect(painted).toEqual(REVIEWED);

    // The panel echoes the painted figure back with the click; that echo, not
    // the queue's own copy, is what may become a ceiling.
    await handler({ id, reviewedFee: painted, type: "wallet.approveOrigin" }, extensionSender);
    await held;

    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.reviewedFee).toEqual(REVIEWED);
  });

  test("a decision that echoes no fee is refused without consuming the request", async () => {
    const { handler, invoked } = makeHarness();
    const held = handler(invokeMessage(), contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    await flushHeld();
    await flushHeld();
    expect(await paintedFee(handler, id)).toEqual(REVIEWED);

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual(
      FEE_REVIEW_REQUIRED,
    );

    expect(invoked).toHaveLength(0);
    expect(await paintedFee(handler, id)).toEqual(REVIEWED);
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await held;
  });

  // The finding: two wallet surfaces are open on one request, a retry on the
  // other surface replaces the fee, and this card has not repainted. Approving
  // it must not enforce the newer, unseen ceiling.
  test("a fee that moved since the card was painted is refused, not substituted", async () => {
    const estimates = [
      { overallFee: "1000", unit: "FRI" },
      { overallFee: "9999999", unit: "FRI" },
    ];
    let next = 0;
    const { handler, invoked } = makeHarness([account], undefined, {
      estimateInvokeFee: () => {
        const fee = estimates[Math.min(next, estimates.length - 1)];
        next += 1;
        return Promise.resolve(fee as FeeEstimate);
      },
    });
    const held = handler(invokeMessage(), contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    await flushHeld();
    await flushHeld();
    const painted = await paintedFee(handler, id);
    expect(painted).toEqual(estimates[0] as FeeEstimate);

    // The other surface re-estimates; this card still shows 1000 FRI.
    await expect(
      handler({ id, type: "wallet.retryApprovalFee" }, extensionSender),
    ).resolves.toEqual({ ok: true });
    expect(await paintedFee(handler, id)).toEqual(estimates[1] as FeeEstimate);

    await expect(
      handler({ id, reviewedFee: painted, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toEqual({ error: MOVED_FEE_REFUSAL });
    expect(invoked).toHaveLength(0);
    expect(await paintedFee(handler, id)).toEqual(estimates[1] as FeeEstimate);

    // A stale surface did not decide the request. The freshly painted surface
    // can still approve it under the figure it now shows.
    await expect(
      handler({ id, reviewedFee: estimates[1], type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toMatchObject({ ok: true });
    await held;
    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.reviewedFee).toEqual(estimates[1] as FeeEstimate);
  });

  // The echo is untrusted input like any other message field, and the same
  // grammar the send lanes validate against. A malformed one refuses the whole
  // decision before the approval is claimed, so nothing is consumed or signed.
  test("a decision carrying a malformed fee is refused before the approval is claimed", async () => {
    const { handler, invoked } = makeHarness();
    const held = handler(invokeMessage(), contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    await flushHeld();
    await flushHeld();

    await expect(
      handler(
        { id, reviewedFee: { overallFee: "-1", unit: "FRI" }, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "invalid approval request" });

    expect(invoked).toHaveLength(0);
    expect(await paintedFee(handler, id)).toEqual(REVIEWED);

    // Settle the still-queued request so the held dapp promise does not dangle.
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await held;
  });

  // Two open wallet surfaces can each ask for a re-estimate, and the wallet does
  // not decide which node answers first. Whichever estimate was STARTED last is
  // the figure the card settles on, so it must also be the figure the submission
  // is held to — an older estimate resolving late must not overwrite it, or the
  // ceiling enforced is one no surface ever displayed.
  test("holds the submission to the newest estimate when two retries race", async () => {
    const estimates: ((fee: { readonly overallFee: string; readonly unit: string }) => void)[] = [];
    const { handler, invoked } = makeHarness([account], undefined, {
      estimateInvokeFee: () =>
        new Promise((resolve) => {
          estimates.push(resolve);
        }),
    });
    const held = handler(invokeMessage(), contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    await flushHeld();
    estimates[0]?.({ overallFee: "1000", unit: "FRI" });
    await flushHeld();

    // Both retries are in flight before either answers: the older one is
    // `estimates[1]`, the newer `estimates[2]`.
    const older = handler({ id, type: "wallet.retryApprovalFee" }, extensionSender);
    const newer = handler({ id, type: "wallet.retryApprovalFee" }, extensionSender);
    await flushHeld();
    expect(estimates).toHaveLength(3);
    estimates[2]?.({ overallFee: "9999999", unit: "FRI" });
    estimates[1]?.({ overallFee: "2000", unit: "FRI" });
    await expect(newer).resolves.toEqual({ ok: true });
    await expect(older).resolves.toMatchObject({ error: expect.any(String) });

    const painted = await paintedFee(handler, id);
    expect(painted).toEqual({ overallFee: "9999999", unit: "FRI" });
    await handler({ id, reviewedFee: painted, type: "wallet.approveOrigin" }, extensionSender);
    await held;

    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.reviewedFee).toEqual({ overallFee: "9999999", unit: "FRI" });
  });

  test("refuses approval when the estimate failed and leaves retry available", async () => {
    const { handler, invoked } = makeHarness([account], undefined, {
      estimateInvokeFee: () => Promise.reject(new Error("node down")),
    });
    const held = handler(invokeMessage(), contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    await flushHeld();
    await flushHeld();

    await expect(handler({ id, type: "wallet.approveOrigin" }, extensionSender)).resolves.toEqual(
      FEE_REVIEW_REQUIRED,
    );

    expect(invoked).toHaveLength(0);
    expect(await paintedFee(handler, id)).toBeNull();
    await handler({ id, type: "wallet.denyOrigin" }, extensionSender);
    await held;
  });
});

const preferences: WalletPreferences = {
  ...defaultWalletPreferences(),
  activeNetworkId: "SN_MAIN",
  tokens: [
    {
      address: ETH,
      decimals: 18,
      id: `SN_MAIN:${ETH}`,
      name: "Ether",
      networkId: "SN_MAIN",
      symbol: "ETH",
    },
  ],
};

// A background wired exactly like the invoke harness, but recording what the
// ERC20 and NFT submit lanes were handed instead of the generic invoke lane.
const makeSendHarness = (overrides: Partial<RuntimeRpc> = {}) => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const transfers: TransferInput[] = [];
  const invoked: InvokeInput[] = [];
  const handler = createMessageHandler(walletStub([account]), testExtension, {
    activity: memoryActivityLog(),
    preferencesStore: fixedPreferencesStore(preferences),
    runtimeRpc: makeRuntimeRpc({
      async getNftOwner() {
        return account.address;
      },
      ...overrides,
      async submitErc20Transfer(input: TransferInput) {
        transfers.push(input);
        return {
          call: { calldata: [], contractAddress: ETH, entrypoint: "transfer" },
          transactionHash: "0x7cd",
        };
      },
      async submitInvokeTransaction(input: InvokeInput) {
        invoked.push(input);
        return { calls: input.calls, transactionHash: "0x7ce" };
      },
    }),
    session,
  });
  return { handler, invoked, transfers };
};

describe("panel send journeys echo the reviewed fee back", () => {
  test("an ERC20 send is bound to the fee its review displayed", async () => {
    const { handler, transfers } = makeSendHarness();

    const review = (await handler(
      {
        accountId: account.id,
        amount: "1",
        recipient: RECIPIENT,
        tokenId: `SN_MAIN:${ETH}`,
        type: "wallet.reviewTransfer",
      },
      extensionSender,
    )) as { readonly review: { readonly fee: unknown } };
    expect(review.review.fee).toEqual(REVIEWED);

    await handler(
      {
        accountId: account.id,
        amount: "1",
        recipient: RECIPIENT,
        reviewedFee: review.review.fee,
        tokenId: `SN_MAIN:${ETH}`,
        type: "wallet.transfer",
      },
      extensionSender,
    );

    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.reviewedFee).toEqual(REVIEWED);
  });

  test("an ERC20 send with no reviewed fee is refused before submission", async () => {
    const { handler, transfers } = makeSendHarness();
    await expect(
      handler(
        {
          accountId: account.id,
          amount: "1",
          recipient: RECIPIENT,
          tokenId: `SN_MAIN:${ETH}`,
          type: "wallet.transfer",
        },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "retry the fee estimate before approving this transaction" });
    expect(transfers).toHaveLength(0);
  });

  test("an undeployed ERC20 send carries separate invoke and deployment ceilings", async () => {
    const { handler, transfers } = makeSendHarness({
      async estimateAccountDeploymentFee() {
        return DEPLOYMENT_REVIEWED;
      },
      async getDeploymentStatus() {
        return false;
      },
    });
    const request = {
      accountId: account.id,
      amount: "1",
      recipient: RECIPIENT,
      tokenId: `SN_MAIN:${ETH}`,
    };
    const review = (await handler(
      { ...request, type: "wallet.reviewTransfer" },
      extensionSender,
    )) as {
      readonly review: { readonly deploymentFee: FeeEstimate; readonly fee: FeeEstimate };
    };
    expect(review.review).toMatchObject({
      deploymentFee: DEPLOYMENT_REVIEWED,
      fee: REVIEWED,
    });

    await handler(
      {
        ...request,
        reviewedDeploymentFee: review.review.deploymentFee,
        reviewedFee: review.review.fee,
        type: "wallet.transfer",
      },
      extensionSender,
    );

    expect(transfers[0]?.reviewedDeploymentFee).toEqual(DEPLOYMENT_REVIEWED);
    expect(transfers[0]?.reviewedFee).toEqual(REVIEWED);
  });

  test("a send carrying a malformed fee is refused before anything is signed", async () => {
    // The echo is untrusted input like any other message field: a value that is
    // not a fee must not be quietly dropped, because a dropped ceiling is an
    // unbound send wearing the appearance of a bound one.
    const { handler, transfers } = makeSendHarness();
    await expect(
      handler(
        {
          accountId: account.id,
          amount: "1",
          recipient: RECIPIENT,
          reviewedFee: { overallFee: "-1", unit: "FRI" },
          tokenId: `SN_MAIN:${ETH}`,
          type: "wallet.transfer",
        },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "invalid transfer request" });
    expect(transfers).toHaveLength(0);
  });

  test("an NFT send is bound to the fee its review displayed", async () => {
    const { handler, invoked } = makeSendHarness();
    const target = {
      contract: ETH,
      networkId: "SN_MAIN",
      tokenId: "1",
    };

    const review = (await handler(
      { ...target, recipient: RECIPIENT, type: "wallet.reviewNftTransfer" },
      extensionSender,
    )) as { readonly review: { readonly fee: unknown } };
    expect(review.review.fee).toEqual(REVIEWED);

    await handler(
      {
        ...target,
        recipient: RECIPIENT,
        reviewedFee: review.review.fee,
        type: "wallet.transferNft",
      },
      extensionSender,
    );

    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.reviewedFee).toEqual(REVIEWED);
  });

  test("an NFT send with no reviewed fee is refused before submission", async () => {
    const { handler, invoked } = makeSendHarness();
    await expect(
      handler(
        {
          contract: ETH,
          networkId: "SN_MAIN",
          recipient: RECIPIENT,
          tokenId: "1",
          type: "wallet.transferNft",
        },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "retry the fee estimate before approving this transaction" });
    expect(invoked).toHaveLength(0);
  });

  test("an undeployed NFT send carries separate invoke and deployment ceilings", async () => {
    const { handler, invoked } = makeSendHarness({
      async estimateAccountDeploymentFee() {
        return DEPLOYMENT_REVIEWED;
      },
      async getDeploymentStatus() {
        return false;
      },
    });
    const target = { contract: ETH, networkId: "SN_MAIN", tokenId: "1" };
    const review = (await handler(
      { ...target, recipient: RECIPIENT, type: "wallet.reviewNftTransfer" },
      extensionSender,
    )) as {
      readonly review: { readonly deploymentFee: FeeEstimate; readonly fee: FeeEstimate };
    };

    await handler(
      {
        ...target,
        recipient: RECIPIENT,
        reviewedDeploymentFee: review.review.deploymentFee,
        reviewedFee: review.review.fee,
        type: "wallet.transferNft",
      },
      extensionSender,
    );

    expect(invoked[0]?.reviewedDeploymentFee).toEqual(DEPLOYMENT_REVIEWED);
    expect(invoked[0]?.reviewedFee).toEqual(REVIEWED);
  });
});
