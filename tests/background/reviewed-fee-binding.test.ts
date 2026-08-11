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
import { createMessageHandler } from "../../src/background/messages";
import { createUnlockSession } from "../../src/background/session";
import type { InvokeInput, TransferInput } from "../../src/starknet/rpc";
import { memoryActivityLog } from "../../src/storage/activity-store";
import {
  defaultWalletPreferences,
  type WalletPreferences,
} from "../../src/storage/preferences-store";
import { flushHeld, latestApprovalId } from "../support/held";
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
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const RECIPIENT = "0x0511a2b3c4d5e6f7";

describe("dapp invoke approval carries its reviewed fee into submission", () => {
  test("submits under the figure the approval card was showing", async () => {
    const { handler, invoked } = makeHarness();
    const held = handler(invokeMessage(), contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    // Let the queued estimate land, so the card is showing a fee rather than
    // "estimating…" when the approval is applied.
    await flushHeld();
    await flushHeld();

    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await held;

    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.reviewedFee).toEqual(REVIEWED);
  });

  test("submits unbound when the estimate failed, rather than inventing a ceiling", async () => {
    // A card that could not show a fee has no consent to enforce. The honest
    // outcome is an unbound submission, not a fabricated limit.
    const { handler, invoked } = makeHarness([account], undefined, {
      estimateInvokeFee: () => Promise.reject(new Error("node down")),
    });
    const held = handler(invokeMessage(), contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    await flushHeld();
    await flushHeld();

    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await held;

    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.reviewedFee).toBeUndefined();
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
const makeSendHarness = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const transfers: TransferInput[] = [];
  const invoked: InvokeInput[] = [];
  const handler = createMessageHandler(walletStub([account]), "extension-id", {
    activity: memoryActivityLog(),
    preferencesStore: fixedPreferencesStore(preferences),
    runtimeRpc: makeRuntimeRpc({
      async getNftOwner() {
        return account.address;
      },
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

  test("a send with no reviewed fee stays unbound rather than being refused", async () => {
    const { handler, transfers } = makeSendHarness();
    await handler(
      {
        accountId: account.id,
        amount: "1",
        recipient: RECIPIENT,
        tokenId: `SN_MAIN:${ETH}`,
        type: "wallet.transfer",
      },
      extensionSender,
    );
    expect(transfers[0]?.reviewedFee).toBeUndefined();
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
});
