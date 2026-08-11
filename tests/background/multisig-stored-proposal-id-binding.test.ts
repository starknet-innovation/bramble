/**
 * MCW-V09-102, stored-record half: a proposal record keeps its call and its
 * transaction id in two independent fields, and only re-hashing the call binds
 * them. Every path that turns a stored record into signed calldata — confirm
 * (both modes), revoke, and execute — re-derives the id offline first, so a
 * record whose id came from somewhere other than its own call (a hostile RPC
 * answer persisted by an earlier version, or a tampered store) cannot make the
 * wallet add quorum to, revoke from, or execute a proposal other than the one
 * the user reviewed. Records tracked by id alone carry no call and stay on the
 * out-of-band acknowledgment path instead.
 */
import { describe, expect, test } from "bun:test";
import { multisigTransactionId } from "../../src/starknet/multisig";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigProposalId,
} from "../../src/storage/multisig-store";
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

  // Revoke signs the stored id as well: an unbound record would pull this
  // signer's confirmation off a proposal the panel is not showing.
  test("refuses to revoke a confirmation named by an unbound stored id", async () => {
    const { handler, invokeCalls, proposal } = await seed(HARNESS_TX_ID, "confirmed");

    await expect(
      handler(
        { proposalId: proposal.id, type: "wallet.revokeMultisigConfirmation" },
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: MISMATCH_ERROR });
    expect(invokeCalls).toEqual([]);
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
