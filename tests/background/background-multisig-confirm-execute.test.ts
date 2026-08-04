/**
 * Confirm-and-execute batching: the signer whose confirmation reaches quorum
 * may broadcast the proposal in the same transaction. The opt-in is only
 * honored when that confirmation actually completes quorum and the original
 * call is known locally, so the batch can never stand in for a missing
 * confirmation or execute a proposal this wallet cannot reconstruct.
 */
import { describe, expect, test } from "bun:test";
import { buildMultisigConfirmCall, buildMultisigExecuteCall } from "../../src/starknet/multisig";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigProposalId,
} from "../../src/storage/multisig-store";
import {
  HARNESS_MULTISIG,
  HARNESS_OTHER_SIGNER,
  HARNESS_TARGET,
  HARNESS_TX_ID,
  harnessAccount,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../support/multisig-harness";

const THIRD_SIGNER = "0x555555555555555555555555555555555555555555555555555555555555555";

const proposalCall = {
  calldata: ["0x5"],
  contractAddress: HARNESS_TARGET,
  entrypoint: "transfer",
  salt: "0x0",
} as const;

// A 3-of-3 multisig so "reaches quorum" and "does not reach quorum" are both
// expressible by moving the reported confirmation count alone.
const makeHarness = async (options: {
  readonly confirmations: number;
  readonly quorum?: number;
  readonly storedQuorum?: number;
  readonly withCall?: boolean;
}) => {
  const quorum = options.quorum ?? 3;
  const signers = [harnessAccount.address, HARNESS_OTHER_SIGNER, THIRD_SIGNER];
  const harness = makeMultisigHarness({
    multisigConfig: () => ({ quorum, signers }),
    proposalStatus: () => ({
      confirmations: options.confirmations,
      confirmedBySigner: false,
      state: "pending",
    }),
    signers,
  });
  const record: MultisigRecord = {
    address: HARNESS_MULTISIG,
    id: multisigId("SN_MAIN", HARNESS_MULTISIG) ?? "",
    networkId: "SN_MAIN",
    quorum: options.storedQuorum ?? quorum,
    signers,
  };
  const proposal: MultisigProposalRecord = {
    call: options.withCall === false ? null : proposalCall,
    confirmations: options.confirmations,
    id: multisigProposalId(record.id, HARNESS_TX_ID) ?? "",
    multisigId: record.id,
    state: "pending",
    summary: "Pay vendor",
    txId: HARNESS_TX_ID,
  };
  await harness.multisigStore.upsertMultisig(record);
  await harness.multisigStore.upsertProposal(proposal);
  return { ...harness, proposal, record };
};

const summaries = async (
  handler: Awaited<ReturnType<typeof makeHarness>>["handler"],
  accountId: string,
): Promise<readonly string[]> => {
  const read = (await handler({ accountId, type: "wallet.activity" }, harnessExtensionSender)) as {
    activity: readonly { summary: string }[];
  };
  return read.activity.map((entry) => entry.summary);
};

describe("multisig confirm and execute", () => {
  test("batches confirm and execute into one invoke when this signer reaches quorum", async () => {
    const { handler, invokeCalls, proposal, record } = await makeHarness({ confirmations: 2 });

    await expect(
      handler(
        { andExecute: true, proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });

    // One transaction, so the confirmation and the execution cannot separate:
    // the component sees the confirm's storage write when execute re-reads it.
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0]).toEqual([
      buildMultisigConfirmCall(HARNESS_MULTISIG, HARNESS_TX_ID),
      buildMultisigExecuteCall(HARNESS_MULTISIG, proposalCall, proposalCall.salt),
    ]);
    expect(await summaries(handler, record.id)).toEqual(["Confirm and execute: Pay vendor"]);
  });

  test("confirms with a single call when the batch is not requested", async () => {
    const { handler, invokeCalls, proposal, record } = await makeHarness({ confirmations: 2 });

    await expect(
      handler(
        { proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(invokeCalls[0]).toEqual([buildMultisigConfirmCall(HARNESS_MULTISIG, HARNESS_TX_ID)]);
    expect(await summaries(handler, record.id)).toEqual(["Confirm: Pay vendor"]);
  });

  test("refuses to batch an execution that quorum is not yet ready for", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({ confirmations: 0 });

    await expect(
      handler(
        { andExecute: true, proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error:
        "this confirmation does not reach quorum (1 of 3), so it cannot execute yet — confirm without executing",
    });
    // Nothing is broadcast: the signer asked for one atomic action, so falling
    // back to a bare confirmation would submit something they did not request.
    expect(invokeCalls).toHaveLength(0);
  });

  test("plans against the freshly read quorum, not the stored one", async () => {
    // Stale storage says 3-of-3, which would reject this batch; the chain says
    // 2-of-3, which allows it. resolveMultisigTarget re-reads config before the
    // plan runs, so the chain value is the one that decides.
    const { handler, invokeCalls, proposal, record } = await makeHarness({
      confirmations: 1,
      quorum: 2,
      storedQuorum: 3,
    });
    expect(record.quorum).toBe(3);

    await expect(
      handler(
        { andExecute: true, proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls[0]).toHaveLength(2);
  });

  test("refuses the batch when the chain raised quorum above the stored value", async () => {
    // The mirror case: storage would allow the batch, the chain refuses it.
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 1,
      quorum: 3,
      storedQuorum: 2,
    });

    await expect(
      handler(
        { andExecute: true, proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error:
        "this confirmation does not reach quorum (2 of 3), so it cannot execute yet — confirm without executing",
    });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to batch when the proposal was tracked by id only", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 2,
      withCall: false,
    });

    await expect(
      handler(
        {
          andExecute: true,
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error:
        "this proposal was tracked by id only; executing needs the original call, so confirm it here and execute from the wallet that proposed it",
    });
    expect(invokeCalls).toHaveLength(0);
  });

  test("rejects an unparseable andExecute rather than silently confirming", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({ confirmations: 2 });

    await expect(
      handler(
        { andExecute: "yes", proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "invalid confirm request" });
    expect(invokeCalls).toHaveLength(0);
  });
});
