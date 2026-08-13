/**
 * MCW-V09-108: every path that can grant an ERC20 allowance must file it in the
 * allowance log, or the manager shows nothing for a spender this wallet itself
 * approved and the user has no way to see — or undo — what it may take. The
 * dapp-invoke path is covered by the provider tests and the in-wallet swap by
 * `swap-ops.test.ts`; this pins the other two that were left unrecorded: a
 * multisig execution and a pool (STRK20) submission.
 */
import { describe, expect, test } from "bun:test";
import type { AllowanceView } from "@mc-wallet/transactions/allowance-discovery";
import { DEFAULT_TOKENS } from "@mc-wallet/wallet-model/networks";
import { num } from "starknet";
import {
  flushHeld,
  latestApprovalId,
  reviewedApprovalFee,
  waitForPendingApprovals,
} from "../support/held";
import {
  failingInvokeActivityLog,
  invokeContentSender,
  invokeExtensionSender,
  invokeMessage,
  makeInvokeHarness,
} from "../support/invoke-approval-harness";
import {
  HARNESS_MULTISIG,
  HARNESS_TARGET,
  harnessAccount,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../support/multisig-harness";
import {
  buildStrk20Handler,
  makeStrk20Service,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../support/strk20-background";

const ETH = DEFAULT_TOKENS.find((token) => token.networkId === "SN_MAIN" && token.symbol === "ETH")
  ?.address as string;
const SPENDER = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";
const CANONICAL_SPENDER = num.toHex(BigInt(SPENDER));

const listAllowances = async (
  handler: ReturnType<typeof makeMultisigHarness>["handler"],
): Promise<readonly AllowanceView[]> => {
  const response = await handler({ type: "wallet.allowances" }, harnessExtensionSender);
  return "allowances" in response ? (response.allowances as readonly AllowanceView[]) : [];
};

describe("allowance recording covers every granting path", () => {
  // MCW-V09-108: the allowance log must not sit behind another store's write.
  // An activity log that rejects after broadcast (quota, IO) once dropped the
  // bookkeeping entirely, leaving an on-chain grant the manager could never
  // list or revoke.
  test("a dapp approve is filed even when the activity write fails after broadcast", async () => {
    const { handler, invoked } = makeInvokeHarness(
      undefined,
      undefined,
      {},
      failingInvokeActivityLog(),
    );
    const unlimited = "0xffffffffffffffffffffffffffffffff";
    const held = handler(
      invokeMessage(undefined, [
        { calldata: [SPENDER, unlimited, unlimited], contractAddress: ETH, entrypoint: "approve" },
      ]),
      invokeContentSender,
    );
    await flushHeld();
    const id = await latestApprovalId(handler, invokeExtensionSender);
    const reviewedFee = await reviewedApprovalFee(handler, invokeExtensionSender, id);
    await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, invokeExtensionSender);
    await held;

    expect(invoked).toHaveLength(1);
    const listed = await handler({ type: "wallet.allowances" }, invokeExtensionSender);
    expect("allowances" in listed ? listed.allowances : []).toMatchObject([
      { source: "wallet", spender: CANONICAL_SPENDER },
    ]);
  });

  test("a multisig execution files the grant under the multisig, not its signer", async () => {
    const { handler } = makeMultisigHarness({
      proposalStatus: () => ({ confirmations: 1, confirmedBySigner: false, state: "confirmed" }),
    });
    const watched = (await handler(
      { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
      harnessExtensionSender,
    )) as { multisig: { id: string } };
    const proposed = (await handler(
      {
        calldata: [SPENDER, "0x3e8", "0x0"],
        entrypoint: "approve",
        multisigId: watched.multisig.id,
        summary: "Approve market maker",
        to: ETH,
        type: "wallet.proposeMultisigTx",
      },
      harnessExtensionSender,
    )) as { proposal: { id: string } };

    // Nothing is granted until the proposal actually executes.
    expect(await listAllowances(handler)).toEqual([]);
    await expect(
      handler(
        { proposalId: proposed.proposal.id, type: "wallet.executeMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });

    const [granted, ...rest] = await listAllowances(handler);
    expect(rest).toEqual([]);
    expect(granted).toMatchObject({
      accountId: watched.multisig.id,
      amount: "1000",
      source: "multisig",
      spender: CANONICAL_SPENDER,
    });
    // The signer never granted it, so it is not revokable from this account —
    // that takes a proposal the multisig's own quorum executes.
    await expect(
      handler({ id: granted?.id, type: "wallet.revokeAllowance" }, harnessExtensionSender),
    ).resolves.toEqual({ error: "switch to the account that granted this allowance" });
  });

  test("a multisig proposal that grants nothing files nothing", async () => {
    const { handler } = makeMultisigHarness({
      proposalStatus: () => ({ confirmations: 1, confirmedBySigner: false, state: "confirmed" }),
    });
    const watched = (await handler(
      { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
      harnessExtensionSender,
    )) as { multisig: { id: string } };
    const proposed = (await handler(
      {
        calldata: ["0x5", "0x0"],
        entrypoint: "transfer",
        multisigId: watched.multisig.id,
        summary: "Pay vendor",
        to: HARNESS_TARGET,
        type: "wallet.proposeMultisigTx",
      },
      harnessExtensionSender,
    )) as { proposal: { id: string } };
    await handler(
      { proposalId: proposed.proposal.id, type: "wallet.executeMultisigProposal" },
      harnessExtensionSender,
    );

    expect(await listAllowances(handler)).toEqual([]);
  });

  test("a confirm-and-execute in one transaction records the same grant", async () => {
    const { handler } = makeMultisigHarness({
      multisigConfig: () => ({ quorum: 2, signers: [harnessAccount.address, HARNESS_TARGET] }),
      proposalStatus: () => ({ confirmations: 1, confirmedBySigner: false, state: "pending" }),
    });
    const watched = (await handler(
      { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
      harnessExtensionSender,
    )) as { multisig: { id: string } };
    const proposed = (await handler(
      {
        calldata: [SPENDER, "0x7", "0x0"],
        entrypoint: "increase_allowance",
        multisigId: watched.multisig.id,
        summary: "Top up market maker",
        to: ETH,
        type: "wallet.proposeMultisigTx",
      },
      harnessExtensionSender,
    )) as { proposal: { id: string } };
    await expect(
      handler(
        {
          mode: "confirm-and-execute",
          proposalId: proposed.proposal.id,
          type: "wallet.confirmMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });

    // Filed as a LOWER BOUND, not as the standing allowance: the proposal
    // increased an allowance whose base the wallet never saw, and the multisig
    // is not this account, so nothing local can know the total. The panel
    // renders it as "at least 7"; claiming 7 outright would understate a
    // treasury approval, which is the exact failure this finding is about.
    expect(await listAllowances(handler)).toMatchObject([
      { accountId: watched.multisig.id, amount: "7", lowerBound: true, source: "multisig" },
    ]);
  });

  // The multisig row is not stranded on that bound: `allowance(multisig,
  // spender)` is readable, and the read is issued for the MULTISIG's own
  // address, so the manager can state the treasury's real exposure.
  test("a multisig row is corrected by an on-chain reading taken for the multisig", async () => {
    const unlimited = ((1n << 128n) + 5n).toString();
    const readPairs: { readonly owner: string }[] = [];
    const { handler } = makeMultisigHarness({
      getTrackedAllowances: async (input) => {
        readPairs.push(...input.pairs);
        return input.pairs.map((pair) => ({ amount: unlimited, id: pair.id }));
      },
      multisigConfig: () => ({ quorum: 2, signers: [harnessAccount.address, HARNESS_TARGET] }),
      proposalStatus: () => ({ confirmations: 1, confirmedBySigner: false, state: "pending" }),
    });
    const watched = (await handler(
      { address: HARNESS_MULTISIG, name: "Treasury", type: "wallet.addMultisig" },
      harnessExtensionSender,
    )) as { multisig: { id: string } };
    const proposed = (await handler(
      {
        calldata: [SPENDER, "0x7", "0x0"],
        entrypoint: "increase_allowance",
        multisigId: watched.multisig.id,
        summary: "Top up market maker",
        to: ETH,
        type: "wallet.proposeMultisigTx",
      },
      harnessExtensionSender,
    )) as { proposal: { id: string } };
    await handler(
      {
        mode: "confirm-and-execute",
        proposalId: proposed.proposal.id,
        type: "wallet.confirmMultisigProposal",
      },
      harnessExtensionSender,
    );

    const listed = await listAllowances(handler);
    expect(listed).toMatchObject([
      { accountId: watched.multisig.id, amount: unlimited, source: "multisig" },
    ]);
    expect(listed[0]?.lowerBound).toBeUndefined();
    expect(readPairs.map((pair) => BigInt(pair.owner))).toEqual([BigInt(HARNESS_MULTISIG)]);
  });

  // Entering the pool approves it to pull the deposit from the account's
  // PUBLIC balance. The submitter reports that grant, and the wallet must file
  // it: a pool that keeps a residual allowance is a spender like any other.
  test("a pool submission files the approvals it reported granting", async () => {
    const poolSpender = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";
    const handler = buildStrk20Handler({
      strk20: {
        ...makeStrk20Service(),
        async submitActions() {
          return {
            allowanceGrants: [
              {
                calldata: [poolSpender, "0x64", "0x0"],
                contractAddress: STRK20_TOKEN,
                entrypoint: "approve",
              },
            ],
            transactionHash: "0x123",
          };
        },
      },
    });
    const held = handler(
      {
        actions: [
          { amount: "0x0a", recipient: STRK20_RECIPIENT, token: STRK20_TOKEN, type: "withdraw" },
        ],
        origin: STRK20_ORIGIN,
        type: "wallet.strk20InvokeTransaction",
      },
      STRK20_CONTENT_SENDER,
    );
    await flushHeld();
    const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
    await handler({ id, type: "wallet.approveOrigin" }, STRK20_EXTENSION_SENDER);
    await expect(held).resolves.toMatchObject({ ok: true });

    const listed = await handler({ type: "wallet.allowances" }, STRK20_EXTENSION_SENDER);
    expect("allowances" in listed ? listed.allowances : []).toMatchObject([
      { amount: "100", source: "wallet", spender: num.toHex(BigInt(poolSpender)) },
    ]);
  });
});

/**
 * The log is not only a manager listing: it is what the NEXT review knows the
 * account has already allowed. A `2^128 - 2` grant plus a one-wei top-up reaches
 * the conventional max-u128 unlimited sentinel, and while the review's running total
 * started at zero the wallet said nothing about the second call — the whole
 * grant was hidden in the gap between the two transactions.
 *
 * Driven end to end through the real handler on purpose: the rule itself is
 * pinned in tests/starknet/verify-increase-allowance.test.ts, and what rots is
 * the wiring — a review that never asks the log is exactly as blind as one that
 * cannot.
 */
const JUST_UNDER_UNLIMITED = `0x${((1n << 128n) - 2n).toString(16)}`;

const approvalCard = async (
  handler: ReturnType<typeof makeInvokeHarness>["handler"],
): Promise<{
  readonly flags?: readonly { readonly code: string }[];
  readonly id: string;
}> => {
  const pending = await waitForPendingApprovals<{
    readonly flags?: readonly { readonly code: string }[];
    readonly id: string;
  }>(handler, invokeExtensionSender);
  const card = pending.at(-1);
  if (!card) {
    throw new Error("no approval card was queued");
  }
  return card;
};

describe("the invoke review reads the allowance log it writes", () => {
  test("a one-wei top-up reaching the max-u128 sentinel is flagged as unlimited", async () => {
    const { handler } = makeInvokeHarness();
    const granted = handler(
      invokeMessage(undefined, [
        {
          calldata: [SPENDER, JUST_UNDER_UNLIMITED, "0x0"],
          contractAddress: ETH,
          entrypoint: "approve",
        },
      ]),
      invokeContentSender,
    );
    const grantCard = await approvalCard(handler);
    // The grant itself stops one wei short of the threshold, so the card that
    // authorized it raised nothing — which is what makes the top-up invisible.
    expect(grantCard.flags?.map((flag) => flag.code) ?? []).not.toContain("unlimited-approval");
    const reviewedFee = await reviewedApprovalFee(handler, invokeExtensionSender, grantCard.id);
    await handler(
      { id: grantCard.id, reviewedFee, type: "wallet.approveOrigin" },
      invokeExtensionSender,
    );
    await granted;

    const topUp = handler(
      invokeMessage(undefined, [
        {
          calldata: [SPENDER, "0x1", "0x0"],
          contractAddress: ETH,
          entrypoint: "increase_allowance",
        },
      ]),
      invokeContentSender,
    );
    const topUpCard = await approvalCard(handler);

    expect(topUpCard.flags?.map((flag) => flag.code) ?? []).toContain("unlimited-approval");
    await handler({ id: topUpCard.id, type: "wallet.denyOrigin" }, invokeExtensionSender);
    await expect(topUp).resolves.toEqual({ error: "request rejected" });
  });
});
