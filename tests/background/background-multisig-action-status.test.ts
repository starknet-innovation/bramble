/**
 * Multisig action status gates: confirm, revoke, and execute refresh proposal
 * state immediately before signing so stale local state cannot burn fees.
 */
import { describe, expect, test } from "bun:test";
import type { MultisigProposalStatus } from "../../src/starknet/multisig";
import {
  type MultisigProposalRecord,
  type MultisigRecord,
  multisigId,
  multisigProposalId,
} from "../../src/storage/multisig-store";
import {
  HARNESS_MULTISIG,
  HARNESS_TARGET,
  harnessAccount,
  harnessExtensionSender,
  harnessTxId,
  makeMultisigHarness,
} from "../support/multisig-harness";

const proposalCall = {
  calldata: ["0x5"],
  contractAddress: HARNESS_TARGET,
  entrypoint: "transfer",
  salt: "0x0",
} as const;

// Executable fixtures are filed under the id their own call hashes to; the
// execute path re-derives it offline before building any invoke.
const PROPOSAL_TX_ID = harnessTxId(proposalCall);

const makeHarness = async (status: MultisigProposalStatus | "throw") => {
  const { handler, invokeCalls, multisigStore } = makeMultisigHarness({
    proposalStatus: () => {
      if (status === "throw") {
        throw new Error("rpc down");
      }
      return status;
    },
    signers: [harnessAccount.address],
  });
  const record: MultisigRecord = {
    address: HARNESS_MULTISIG,
    id: multisigId("SN_MAIN", HARNESS_MULTISIG) ?? "",
    networkId: "SN_MAIN",
    quorum: 1,
    signers: [harnessAccount.address],
  };
  const proposal: MultisigProposalRecord = {
    call: proposalCall,
    confirmations: 0,
    id: multisigProposalId(record.id, PROPOSAL_TX_ID) ?? "",
    multisigId: record.id,
    state: "pending",
    summary: "Pay vendor",
    txId: PROPOSAL_TX_ID,
  };
  await multisigStore.upsertMultisig(record);
  await multisigStore.upsertProposal(proposal);
  return { handler, invokeCalls, proposal };
};

const actionMessage = (
  type:
    | "wallet.confirmMultisigProposal"
    | "wallet.executeMultisigProposal"
    | "wallet.revokeMultisigConfirmation",
  proposalId: string,
) =>
  type === "wallet.confirmMultisigProposal"
    ? { mode: "confirm-only" as const, proposalId, type }
    : { proposalId, type };

describe("multisig action status gates", () => {
  test("fails closed when proposal status cannot be refreshed", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness("throw");
    await expect(
      handler(actionMessage("wallet.confirmMultisigProposal", proposal.id), harnessExtensionSender),
    ).resolves.toEqual({ error: "could not refresh proposal status — try again" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to confirm when this signer already confirmed", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 1,
      confirmedBySigner: true,
      state: "pending",
    });
    await expect(
      handler(actionMessage("wallet.confirmMultisigProposal", proposal.id), harnessExtensionSender),
    ).resolves.toEqual({ error: "this account has already confirmed this proposal" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to revoke when this signer has not confirmed", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 0,
      confirmedBySigner: false,
      state: "pending",
    });
    await expect(
      handler(
        actionMessage("wallet.revokeMultisigConfirmation", proposal.id),
        harnessExtensionSender,
      ),
    ).resolves.toEqual({ error: "this account has not confirmed this proposal" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to execute before quorum is met", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 0,
      confirmedBySigner: false,
      state: "pending",
    });
    await expect(
      handler(actionMessage("wallet.executeMultisigProposal", proposal.id), harnessExtensionSender),
    ).resolves.toEqual({ error: "cannot execute a proposal that is pending" });
    expect(invokeCalls).toHaveLength(0);
  });

  test("refuses to confirm when proposal already has quorum", async () => {
    const { handler, invokeCalls, proposal } = await makeHarness({
      confirmations: 2,
      confirmedBySigner: false,
      state: "confirmed",
    });
    await expect(
      handler(actionMessage("wallet.confirmMultisigProposal", proposal.id), harnessExtensionSender),
    ).resolves.toEqual({
      error: "proposal already has quorum — execute it instead of adding more confirmations",
    });
    expect(invokeCalls).toHaveLength(0);
  });
});
