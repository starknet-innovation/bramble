/**
 * Confirm-and-execute batching: the signer whose confirmation reaches quorum
 * may broadcast the proposal in the same transaction. The opt-in is only
 * honored when that confirmation actually completes quorum and the original
 * call is known locally, so the batch can never stand in for a missing
 * confirmation or execute a proposal this wallet cannot reconstruct.
 */
import { describe, expect, test } from "bun:test";
import { buildMultisigConfirmCall, buildMultisigExecuteCall } from "@mc-wallet/multisig/chain";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  type MultisigStore,
  memoryMultisigStore,
  multisigId,
  multisigProposalId,
} from "@mc-wallet/multisig/repository";
import {
  HARNESS_MULTISIG,
  HARNESS_OTHER_SIGNER,
  HARNESS_TARGET,
  harnessAccount,
  harnessExtensionSender,
  harnessTxId,
  makeMultisigHarness,
} from "../../support/multisig-harness";

const THIRD_SIGNER = "0x555555555555555555555555555555555555555555555555555555555555555";

const proposalCall = {
  calldata: ["0x5"],
  contractAddress: HARNESS_TARGET,
  entrypoint: "transfer",
  salt: "0x0",
} as const;

// The real component id for that call: an execute is only ever built after the
// stored (call, salt) pair is re-hashed back to the id it is filed under, so a
// fixture that invented an id here would be refused before quorum is checked.
const PROPOSAL_TX_ID = harnessTxId(proposalCall);

// A 3-of-3 multisig so "reaches quorum" and "does not reach quorum" are both
// expressible by moving the reported confirmation count alone.
const makeHarness = async (options: {
  readonly confirmations: number;
  readonly multisigStore?: MultisigStore;
  readonly quorum?: number;
  readonly storedQuorum?: number;
  readonly withCall?: boolean;
}) => {
  const quorum = options.quorum ?? 3;
  const signers = [harnessAccount.address, HARNESS_OTHER_SIGNER, THIRD_SIGNER];
  const harness = makeMultisigHarness({
    multisigConfig: () => ({ quorum, signers }),
    ...(options.multisigStore ? { multisigStore: options.multisigStore } : {}),
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
    id: multisigProposalId(record.id, PROPOSAL_TX_ID) ?? "",
    multisigId: record.id,
    state: "pending",
    summary: "Pay vendor",
    txId: PROPOSAL_TX_ID,
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
  test("estimates the fee for the exact reviewed call batch without broadcasting", async () => {
    const { estimatedCalls, handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 2,
    });
    await expect(
      handler(
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          type: "wallet.prepareMultisigConfirmation",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({
      confirmationReview: {
        fee: { overallFee: "1", unit: "FRI" },
        feeEstimateFailed: false,
        mode: "confirm-and-execute",
        proposalId: proposal.id,
      },
      ok: true,
    });
    expect(estimatedCalls).toEqual([
      [
        buildMultisigConfirmCall(HARNESS_MULTISIG, PROPOSAL_TX_ID),
        buildMultisigExecuteCall(HARNESS_MULTISIG, proposalCall, proposalCall.salt),
      ],
    ]);
    expect(invokeCalls).toHaveLength(0);
  });

  test("binds the co-signing invoke to the fee its review displayed", async () => {
    // MCW-V09-119: the review returns a fee, the panel echoes it back, and the
    // submission carries it as a ceiling. Without the echo the signer's STRK is
    // spent at whatever the node quotes when the click lands.
    const { handler, proposal, submittedInvokes } = await makeHarness({ confirmations: 2 });
    const review = (await handler(
      {
        mode: "confirm-and-execute",
        proposalId: proposal.id,
        type: "wallet.prepareMultisigConfirmation",
      },
      harnessExtensionSender,
    )) as { readonly confirmationReview: { readonly fee: unknown } };

    await expect(
      handler(
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          reviewedFee: review.confirmationReview.fee,
          type: "wallet.confirmMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(submittedInvokes).toHaveLength(1);
    expect(submittedInvokes[0]?.reviewedFee).toEqual({ overallFee: "1", unit: "FRI" });
  });

  test("refuses a confirmation whose echoed fee is not a fee", async () => {
    const { handler, proposal, submittedInvokes } = await makeHarness({ confirmations: 2 });
    await expect(
      handler(
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          reviewedFee: { overallFee: "1", unit: "STRK" },
          type: "wallet.confirmMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ error: expect.any(String) });
    expect(submittedInvokes).toHaveLength(0);
  });

  test("batches confirm and execute into one invoke when this signer reaches quorum", async () => {
    const { handler, invokeCalls, proposal, record } = await makeHarness({ confirmations: 2 });

    await expect(
      handler(
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });

    // One transaction, so the confirmation and the execution cannot separate:
    // the component sees the confirm's storage write when execute re-reads it.
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0]).toEqual([
      buildMultisigConfirmCall(HARNESS_MULTISIG, PROPOSAL_TX_ID),
      buildMultisigExecuteCall(HARNESS_MULTISIG, proposalCall, proposalCall.salt),
    ]);
    expect(await summaries(handler, record.id)).toEqual(["Confirm and execute: Pay vendor"]);
  });

  test("confirms with a single call when the batch is not requested", async () => {
    const { handler, invokeCalls, proposal, record } = await makeHarness({ confirmations: 2 });

    await expect(
      handler(
        {
          mode: "confirm-only",
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(invokeCalls[0]).toEqual([buildMultisigConfirmCall(HARNESS_MULTISIG, PROPOSAL_TX_ID)]);
    expect(await summaries(handler, record.id)).toEqual(["Confirm: Pay vendor"]);
  });

  test("refuses to batch an execution that quorum is not yet ready for", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({ confirmations: 0 });

    await expect(
      handler(
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
        },
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
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
        },
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
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
        },
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
          mode: "confirm-and-execute",
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

  test("rejects an unknown mode rather than silently confirming", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({ confirmations: 2 });

    await expect(
      handler(
        { mode: "yes", proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "invalid confirm request" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("serializes duplicate confirmation submissions across extension surfaces", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = makeMultisigHarness({
      multisigConfig: () => ({
        quorum: 3,
        signers: [harnessAccount.address, HARNESS_OTHER_SIGNER, THIRD_SIGNER],
      }),
      proposalStatus: () => ({
        confirmations: 2,
        confirmedBySigner: false,
        state: "pending",
      }),
      signers: [harnessAccount.address, HARNESS_OTHER_SIGNER, THIRD_SIGNER],
      submitInvoke: async () => {
        await held;
        return { transactionHash: "0x7cd" };
      },
    });
    const record: MultisigRecord = {
      address: HARNESS_MULTISIG,
      id: multisigId("SN_MAIN", HARNESS_MULTISIG) ?? "",
      networkId: "SN_MAIN",
      quorum: 3,
      signers: [harnessAccount.address, HARNESS_OTHER_SIGNER, THIRD_SIGNER],
    };
    const proposal: MultisigProposalRecord = {
      call: proposalCall,
      confirmations: 2,
      id: multisigProposalId(record.id, PROPOSAL_TX_ID) ?? "",
      multisigId: record.id,
      state: "pending",
      summary: "Pay vendor",
      txId: PROPOSAL_TX_ID,
    };
    await harness.multisigStore.upsertMultisig(record);
    await harness.multisigStore.upsertProposal(proposal);
    const message = {
      mode: "confirm-and-execute",
      proposalId: proposal.id,
      type: "wallet.confirmMultisigProposal",
    } as const;

    const first = harness.handler(message, harnessExtensionSender);
    for (let turn = 0; turn < 8 && harness.invokeCalls.length === 0; turn += 1) {
      await Promise.resolve();
    }
    await expect(harness.handler(message, harnessExtensionSender)).resolves.toMatchObject({
      error: expect.stringContaining("proposal action in progress"),
    });
    expect(harness.invokeCalls).toHaveLength(1);
    release();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  test("retains the claim when post-broadcast hash persistence fails", async () => {
    const base = memoryMultisigStore();
    const multisigStore: MultisigStore = {
      ...base,
      async setOperationHash() {
        throw new Error("storage unavailable");
      },
    };
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 2,
      multisigStore,
    });
    const message = {
      mode: "confirm-and-execute",
      proposalId: proposal.id,
      type: "wallet.confirmMultisigProposal",
    } as const;

    await expect(handler(message, harnessExtensionSender)).resolves.toMatchObject({ ok: true });
    await expect(handler(message, harnessExtensionSender)).resolves.toMatchObject({
      error: expect.stringContaining("proposal action in progress"),
    });
    expect(invokeCalls).toHaveLength(1);
  });
});
