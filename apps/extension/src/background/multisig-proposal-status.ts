/**
 * Signer-specific proposal refresh state. These snapshots improve review UI,
 * but never authorize a transaction: action handlers perform a fresh chain
 * read for the selected signer immediately before every broadcast.
 */
import { canonicalFelt, sameFelt } from "@mc-wallet/wallet-model/networks";
import type {
  MultisigProposalRecord,
  MultisigRecord,
  MultisigStore,
} from "@mc-wallet/multisig/repository";
import type { WalletOpsDeps } from "./wallet-ops";

type ProposalStatusDeps = WalletOpsDeps & { readonly multisigStore: MultisigStore };

/**
 * Checks whether this wallet's submit transaction is still pending. Activity
 * read failure is fail-closed so an optimistic proposal is not erased.
 */
export const isProposalSubmitPending = async (
  deps: ProposalStatusDeps,
  proposal: MultisigProposalRecord,
): Promise<boolean> => {
  const hash = proposal.submitTransactionHash;
  if (!hash) return false;
  try {
    const entries = await deps.activity.list();
    return entries.some((entry) => entry.hash === hash && entry.status === "pending");
  } catch {
    return true;
  }
};

/**
 * Applies one signer-specific chain result to the locally known confirmed set.
 * Inputs have already crossed the RPC/storage validators; this helper performs
 * no I/O and never treats its output as authorization for a submission.
 */
export const confirmedSignersAfterStatus = (
  proposal: MultisigProposalRecord,
  signer: string,
  confirmed: boolean,
): readonly string[] => {
  const known = [
    ...(proposal.confirmedSignerAddresses ?? []),
    ...(proposal.confirmedBySigner === true && proposal.confirmedBySignerAddress
      ? [proposal.confirmedBySignerAddress]
      : []),
  ].filter(
    (address, index, all) => all.findIndex((candidate) => sameFelt(candidate, address)) === index,
  );
  const withoutSigner = known.filter((address) => !sameFelt(address, signer));
  return confirmed ? [...withoutSigner, canonicalFelt(signer) ?? signer] : withoutSigner;
};

const proposalRpc = (deps: ProposalStatusDeps) => {
  const rpc = deps.runtimeRpc.multisig;
  if (!rpc) throw new Error("multisig operations unavailable");
  return rpc;
};

const refreshProposal = async (
  deps: ProposalStatusDeps,
  record: MultisigRecord,
  proposal: MultisigProposalRecord,
  signers: readonly string[],
  activeSigner: string,
  rpcUrls: readonly string[],
): Promise<{ readonly complete: boolean; readonly proposal: MultisigProposalRecord }> => {
  const reads = await Promise.all(
    signers.map(async (signer) => {
      try {
        const status = await proposalRpc(deps).getProposalStatus({
          address: record.address,
          rpcUrls,
          signer,
          txId: proposal.txId,
        });
        return { signer, status };
      } catch {
        return null;
      }
    }),
  );
  const available = reads.filter((read): read is NonNullable<typeof read> => read !== null);
  const first = available[0];
  if (!first) throw new Error("proposal status unavailable");
  if (first.status.state === "not-found" && (await isProposalSubmitPending(deps, proposal))) {
    return { complete: reads.every((read) => read !== null), proposal };
  }
  const selected = available.find((read) => sameFelt(read.signer, activeSigner)) ?? first;
  const confirmedSignerAddresses = available.reduce<readonly string[]>(
    (known, read) =>
      confirmedSignersAfterStatus(
        { ...proposal, confirmedSignerAddresses: known },
        read.signer,
        read.status.confirmedBySigner,
      ),
    proposal.confirmedSignerAddresses ?? [],
  );
  const next: MultisigProposalRecord = {
    ...proposal,
    confirmations: first.status.confirmations,
    confirmedBySigner: selected.status.confirmedBySigner,
    confirmedBySignerAddress: selected.signer,
    confirmedSignerAddresses,
    state: first.status.state,
  };
  await deps.multisigStore.upsertProposal(next);
  return { complete: reads.every((read) => read !== null), proposal: next };
};

/**
 * Refreshes proposals against every signer account this wallet owns. Partial
 * failures retain prior knowledge and mark the result incomplete.
 */
export const refreshMultisigProposals = async (
  deps: ProposalStatusDeps,
  record: MultisigRecord,
  signers: readonly string[],
  activeSigner: string,
  rpcUrls: readonly string[],
): Promise<{
  readonly complete: boolean;
  readonly proposals: readonly MultisigProposalRecord[];
}> => {
  const proposals = (await deps.multisigStore.listProposals()).filter(
    (proposal) => proposal.multisigId === record.id,
  );
  let complete = true;
  const refreshed = await Promise.all(
    proposals.map(async (proposal) => {
      if (proposal.state === "executed") return proposal;
      try {
        const result = await refreshProposal(
          deps,
          record,
          proposal,
          signers,
          activeSigner,
          rpcUrls,
        );
        if (!result.complete) complete = false;
        return result.proposal;
      } catch {
        complete = false;
        return proposal;
      }
    }),
  );
  return { complete, proposals: refreshed };
};
