/**
 * MCW-V09-102, stored-record half: a proposal record keeps its call and its
 * transaction id in two independent fields, and only re-hashing the call binds
 * them. Confirm (both modes) and execute re-derive the id offline first, so a
 * record whose id came from somewhere other than its own call (a hostile RPC
 * answer persisted by an earlier version, or a tampered store) cannot make the
 * wallet add quorum to, or execute, a proposal other than the one the user
 * reviewed. Records tracked by id alone carry no call and stay on the
 * out-of-band acknowledgment path instead.
 *
 * Revocation is the deliberate exception: its calldata is the id alone and it
 * only ever withdraws this signer's authority, so refusing it stranded the
 * victim of the very bug this binding exists to contain. It takes the same
 * acknowledgment an id-only record takes, and is still bounded by the freshly
 * read chain status — an id this signer has not confirmed is refused there.
 */
import { describe, expect, test } from "bun:test";
import { multisigTransactionId } from "@mc-wallet/multisig/chain";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigProposalId,
} from "@mc-wallet/multisig/repository";
import {
  HARNESS_MULTISIG,
  HARNESS_TARGET,
  HARNESS_TX_ID,
  harnessAccount,
  harnessExtensionSender,
  makeMultisigHarness,
} from "../support/multisig-harness";

const proposalCall = {
  calldata: ["0x5"],
  contractAddress: HARNESS_TARGET,
  entrypoint: "transfer",
  salt: "0x0",
} as const;

const MISMATCH_ERROR =
  "this proposal's stored call does not hash to its proposal id — re-track it from the chain before acting on it";

const RECOVERY_ERROR =
  "this proposal's stored call does not hash to its proposal id, so the wallet cannot describe what it does — revoking withdraws your confirmation from that id and nothing else; check the id on a block explorer, then acknowledge to continue";

// A 1-of-1 multisig, so nothing but the id binding stands between the stored
// record and a broadcast invoke: "confirmed" is ready to execute outright, and
// under "pending" this signer's single confirmation completes quorum, which is
// exactly the state the atomic confirm-and-execute batch requires. The default
// call is the one the user reviewed; `null` models a proposal tracked by id.
const seed = async (
  txId: string,
  state: "confirmed" | "pending" = "confirmed",
  call: MultisigProposalRecord["call"] = proposalCall,
) => {
  const harness = makeMultisigHarness({
    // The membership refresh overwrites the stored quorum with what the chain
    // reports, so the 1-of-1 shape has to come from the config read too.
    multisigConfig: () => ({ quorum: 1, signers: [harnessAccount.address] }),
    proposalStatus: () => ({ confirmations: 0, confirmedBySigner: state === "confirmed", state }),
  });
  const record: MultisigRecord = {
    address: HARNESS_MULTISIG,
    id: multisigId("SN_MAIN", HARNESS_MULTISIG) ?? "",
    networkId: "SN_MAIN",
    quorum: 1,
    signers: [harnessAccount.address],
  };
  const proposal: MultisigProposalRecord = {
    call,
    confirmations: 0,
    id: multisigProposalId(record.id, txId) ?? "",
    multisigId: record.id,
    state: "pending",
    summary: "Pay vendor",
    txId,
  };
  await harness.multisigStore.upsertMultisig(record);
  await harness.multisigStore.upsertProposal(proposal);
  return { ...harness, proposal };
};

describe("stored multisig proposal id binding", () => {
  test("refuses to execute a record whose id did not come from its own call", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID);

    await expect(
      handler(
        { proposalId: proposal.id, type: "wallet.executeMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: MISMATCH_ERROR });
    expect(invokeCalls).toEqual([]);
  });

  test("refuses the confirm-and-execute batch for the same record", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "pending");

    await expect(
      handler(
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: MISMATCH_ERROR });
    expect(invokeCalls).toEqual([]);
  });

  test("does not estimate a fee for a batch it would refuse to build", async () => {
    const { estimatedCalls, handler, proposal } = await seed(HARNESS_TX_ID, "pending");

    await expect(
      handler(
        {
          mode: "confirm-and-execute",
          proposalId: proposal.id,
          type: "wallet.prepareMultisigConfirmation",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: MISMATCH_ERROR });
    expect(estimatedCalls).toEqual([]);
  });

  // confirm-only never touches the stored call, but it does put the stored txId
  // straight into `confirm_transaction` calldata — so an unbound record here
  // means the panel shows one proposal while the signature adds quorum to
  // another. This is the co-signer attack the finding describes.
  test("refuses to confirm without executing, which still signs the stored id", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "pending");

    await expect(
      handler(
        { mode: "confirm-only", proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: MISMATCH_ERROR });
    expect(invokeCalls).toEqual([]);
  });

  test("does not estimate a fee for a confirm-only it would refuse to send", async () => {
    const { estimatedCalls, handler, proposal } = await seed(HARNESS_TX_ID, "pending");

    await expect(
      handler(
        {
          mode: "confirm-only",
          proposalId: proposal.id,
          type: "wallet.prepareMultisigConfirmation",
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: MISMATCH_ERROR });
    expect(estimatedCalls).toEqual([]);
  });

  // Revoke is the recovery action for exactly this record shape, so it asks for
  // the acknowledgment rather than refusing outright — but it still refuses
  // until the user has been shown the id and acknowledged it.
  test("refuses an unacknowledged recovery revoke of an unbound record", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "confirmed");

    await expect(
      handler(
        { proposalId: proposal.id, type: "wallet.revokeMultisigConfirmation" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: RECOVERY_ERROR });
    expect(invokeCalls).toEqual([]);
  });

  // The whole safety claim of the recovery path in one assertion: what goes on
  // the wire is the STORED id and nothing else — no id derived from the
  // untrusted call, and no felt of that call.
  test("revokes an unbound record once the id is acknowledged", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "confirmed");

    await expect(
      handler(
        {
          proposalId: proposal.id,
          type: "wallet.revokeMultisigConfirmation",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls.flat()).toMatchObject([
      { calldata: [HARNESS_TX_ID], entrypoint: "revoke_confirmation" },
    ]);
    expect(JSON.stringify(invokeCalls)).not.toContain(
      multisigTransactionId(proposalCall, proposalCall.salt),
    );
    expect(JSON.stringify(invokeCalls)).not.toContain(HARNESS_TARGET);
  });

  // The acknowledgment is not the bound on this path — the fresh chain read is.
  // An id this signer has no confirmation on is refused however loudly the
  // message acknowledges it.
  test("refuses an acknowledged revoke the chain says this signer never confirmed", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "pending");

    await expect(
      handler(
        {
          proposalId: proposal.id,
          type: "wallet.revokeMultisigConfirmation",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "this account has not confirmed this proposal" });
    expect(invokeCalls).toEqual([]);
  });

  // Acknowledging the recovery revoke must not launder the id into the actions
  // that DO attribute it to the stored call.
  test("an acknowledged recovery revoke leaves confirm and execute refused", async () => {
    const { handler, proposal } = await seed(HARNESS_TX_ID, "confirmed");
    await expect(
      handler(
        {
          proposalId: proposal.id,
          type: "wallet.revokeMultisigConfirmation",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      handler(
        {
          mode: "confirm-only",
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: MISMATCH_ERROR });
    await expect(
      handler(
        { proposalId: proposal.id, type: "wallet.executeMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: MISMATCH_ERROR });
    // Execute does not even parse an acknowledgment: the recovery vocabulary
    // exists only on the message that withdraws authority.
    await expect(
      handler(
        {
          proposalId: proposal.id,
          type: "wallet.executeMultisigProposal",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "invalid execute request" });
  });

  // The other way out, and the one the confirm/execute refusal text prescribes:
  // re-tracking from the chain must actually drop the call that hashes
  // elsewhere, or the record comes back exactly as poisoned as it was.
  test("re-tracking an unbound record from the chain clears the poisoned call", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "confirmed");

    await expect(
      handler(
        {
          multisigId: proposal.multisigId,
          txId: proposal.txId,
          type: "wallet.trackMultisigProposal",
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true, proposal: { call: null } });
    await expect(
      handler(
        {
          proposalId: proposal.id,
          type: "wallet.revokeMultisigConfirmation",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls.flat()).toMatchObject([
      { calldata: [HARNESS_TX_ID], entrypoint: "revoke_confirmation" },
    ]);
  });

  // The binding gate must not swallow the id-only product line: a discovered or
  // id-tracked proposal has no call to hash, so it stays on the existing
  // out-of-band acknowledgment path.
  test("still confirms an acknowledged proposal tracked by id alone", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "pending", null);

    await expect(
      handler(
        {
          mode: "confirm-only",
          proposalId: proposal.id,
          type: "wallet.confirmMultisigProposal",
          untrackedVerified: true,
        },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls.flat()).toMatchObject([
      { calldata: [HARNESS_TX_ID], entrypoint: "confirm_transaction" },
    ]);
  });

  test("still asks for acknowledgment on an id-only proposal rather than the binding error", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "pending", null);

    await expect(
      handler(
        { mode: "confirm-only", proposalId: proposal.id, type: "wallet.confirmMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({
      error:
        "verify this proposal on a block explorer or with the proposer, then acknowledge before confirming",
    });
    expect(invokeCalls).toEqual([]);
  });

  test("confirms and executes normally once the record is filed under its call's id", async () => {
    const bound = multisigTransactionId(proposalCall, proposalCall.salt);
    const { handler, invokeCalls, proposal } = await seed(bound, "pending");

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
    expect(invokeCalls.flat()).toMatchObject([
      { entrypoint: "confirm_transaction" },
      { entrypoint: "execute_transaction" },
    ]);
  });

  test("executes normally once the record is filed under the id its call hashes to", async () => {
    const bound = multisigTransactionId(proposalCall, proposalCall.salt);
    const { handler, invokeCalls, proposal } = await seed(bound);

    await expect(
      handler(
        { proposalId: proposal.id, type: "wallet.executeMultisigProposal" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls.flat()).toMatchObject([{ entrypoint: "execute_transaction" }]);
  });

  test("revokes normally once the record is filed under the id its call hashes to", async () => {
    const bound = multisigTransactionId(proposalCall, proposalCall.salt);
    const { handler, invokeCalls, proposal } = await seed(bound, "confirmed");

    await expect(
      handler(
        { proposalId: proposal.id, type: "wallet.revokeMultisigConfirmation" },
        harnessExtensionSender,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(invokeCalls.flat()).toMatchObject([
      { calldata: [bound], entrypoint: "revoke_confirmation" },
    ]);
  });
});
