/**
 * Resolution, recipient policy, submission, and status plumbing shared by the
 * transaction-submitting multisig handlers in ./multisig-tx-ops.
 *
 * Split out of that module so each side stays readable and under the file
 * limit: this one answers "which multisig, which signer, is this recipient
 * allowed, and how does a broadcast get recorded", and the handler module is
 * left as the five message handlers that compose those answers.
 *
 * Trust boundary: every input reaching these helpers came from an extension
 * message or from the stored proposal registry, so both are treated as
 * untrusted — signer membership is re-proved from chain, the proposal's inner
 * call is re-verified against the wallet's own trusted set, and every submission
 * claims an operation slot before it broadcasts. Failures return a displayable
 * `{ error }` rather than throwing, except for RPC faults inside a claimed
 * submission, which release the claim and rethrow.
 */
import type { Call } from "starknet";
import type { FeeEstimate } from "@mc-wallet/starknet/fee-bounds";
import type { MultisigCallInput, MultisigProposalStatus } from "@mc-wallet/multisig/chain";
import { refuseOnPoisonedRecipient, verificationContext, verifyCalls } from "@mc-wallet/transactions/verify";
import type { MultisigProposalCall, MultisigProposalRecord, MultisigRecord } from "@mc-wallet/multisig/repository";
import { withAddressBookId } from "@mc-wallet/wallet-model/preferences";
import type { AddressBookEntry } from "@mc-wallet/settings/preferences";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { type MultisigContext, type MultisigOpsDeps, multisigContext, multisigRpc, refreshSignerMembership } from "./multisig-ops";
import { bindingError, requireUntrackedVerification } from "./multisig-proposal-guards";
import { confirmedSignersAfterStatus, isProposalSubmitPending } from "./multisig-proposal-status";
import { claimMultisigProposalOperation, type MultisigProposalOperationKind, recordClaimedMultisigSubmission, recordSubmittedActivity, releaseMultisigOperation } from "./multisig-submission";
import { activeAccountContext } from "../runtime/runtime-state";
import { signerForContext } from "../accounts/wallet-ops";

/**
 * A stored proposal together with the signer context an action on it resolved
 * to. Every signer-gated handler works from one of these.
 */
export type ResolvedProposal = {
  readonly proposal: MultisigProposalRecord;
  readonly resolved: MultisigContext;
};

/**
 * What one proposal action will broadcast: the calls for a single invoke plus
 * the activity summary describing them. `executed` names the inner proposal
 * call the multisig will run, present only on the actions that execute one, so
 * allowance bookkeeping is driven by the plan rather than re-derived per
 * handler.
 */
export type ProposalActionPlan = {
  readonly calls: readonly Call[];
  readonly executed?: MultisigProposalCall;
  readonly summary: string;
};

/**
 * Resolves the selected signer + watched record and re-proves signer membership
 * in one step. Every signer-gated submission runs this first so stale registry
 * data can never offer a transaction the chain would reject.
 */
export const resolveMultisigTarget = async (
  deps: MultisigOpsDeps,
  id: string,
  signerAccountId?: string,
): Promise<{ readonly error: string } | MultisigContext> => {
  // Every caller is a submission the user just confirmed: the renewing read.
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  const resolved = await multisigContext(deps, { active, id, signerAccountId });
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  return refreshSignerMembership(deps, resolved);
};

// The multisig itself is an address this wallet knows: it is a watched record
// with a stored address, and a treasury address is public on chain, which makes
// it exactly the kind of address a duster mimics. Folding it into the trusted
// set the shared verifier scopes means a lookalike of the vault's OWN address is
// refused alongside a lookalike of a saved contact. It can only ever add a
// refusal, never remove one, and it goes through the shared id builder so the
// synthetic entry is spelled exactly like a stored contact.
const watchedMultisigContact = (record: MultisigRecord): AddressBookEntry =>
  withAddressBookId({
    address: record.address,
    label: record.name ?? "Watched multisig",
    networkId: record.networkId,
  });

/**
 * The recipient policy for a multisig proposal's INNER call — the call the
 * multisig itself will run — applied before the wallet broadcasts anything that
 * proposes, co-signs, or executes it.
 *
 * This is the same shared {@link refuseOnPoisonedRecipient} the public ERC20
 * send, the NFT send, the swap, the dapp invoke, and the privacy pool routes
 * apply, verified against the same network-scoped trusted set. Without it the
 * multisig line was the one send composer whose recipient risk existed only as
 * an advisory string in the side panel (MCW-V09-109): the proposal composer
 * builds its transfer with the very same `buildErc20TransferCall` the public
 * send uses, so one route refusing and the other not was a parity hole, not a
 * difference in kind.
 *
 * The outer submit/confirm/execute wrapper is deliberately not what is verified:
 * its calldata is the encoded inner call, which would decode as an opaque call
 * to the multisig contract and hide the recipient entirely.
 *
 * Returns the refusal to hand straight back to the caller, or `null` to proceed.
 */
export const refusePoisonedProposalRecipient = async (
  deps: MultisigOpsDeps,
  resolved: MultisigContext,
  call: MultisigCallInput,
): Promise<{ readonly error: string } | null> => {
  const preferences = await deps.preferencesStore.read();
  return refuseOnPoisonedRecipient(
    verifyCalls(
      [
        {
          calldata: [...call.calldata],
          contractAddress: call.contractAddress,
          entrypoint: call.entrypoint,
        },
      ],
      verificationContext(resolved.account.account, {
        ...preferences,
        addressBook: [...preferences.addressBook, watchedMultisigContact(resolved.record)],
      }),
    ),
  );
};

/**
 * Submits one or more calls as a single invoke through the shared path and
 * records activity. The caller's descriptive summary is recorded verbatim: the
 * generic call decoder cannot describe multisig entrypoints, and the dedup
 * guards match on these summaries, so they must stay deterministic and specific.
 * Batched calls share one transaction, so they succeed or revert together.
 */
export const submitAndRecord = async (
  deps: MultisigOpsDeps,
  resolved: MultisigContext,
  calls: readonly Call[],
  summary: string,
): Promise<string> => {
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: resolved.account.account,
    calls,
    rpcUrls: resolved.rpcUrls,
    signHash: signerForContext(deps, resolved.account),
  });
  await recordSubmittedActivity(deps.activity, {
    accountId: resolved.record.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: resolved.account.networkId,
    summary,
  });
  return result.transactionHash;
};

/**
 * Submits a claimed proposal action, releasing the claim if the broadcast
 * itself fails so a transient RPC fault cannot wedge the signer's slot.
 *
 * `reviewedFee` is the estimate the confirmation review showed for these exact
 * calls; supplying it makes that figure the ceiling this co-signing invoke may
 * sign under, so a cost that has moved since the review is refused rather than
 * signed (MCW-V09-119). Omitted where no fee was reviewed.
 */
export const submitClaimedAndRecord = async (
  deps: MultisigOpsDeps,
  resolved: MultisigContext,
  plan: ProposalActionPlan,
  operationId: string,
  reviewedFee?: FeeEstimate,
): Promise<string> => {
  // Read BEFORE the broadcast, though it is only used after it: everything
  // past the submit is bookkeeping, and a preferences read that failed there
  // would turn a transaction already on its way into a thrown error. The signer
  // and the multisig share a network, so the signer's trusted set names the
  // same tokens and collections the multisig's grant is classified against.
  const assets = plan.executed
    ? verificationContext(resolved.account.account, await deps.preferencesStore.read())
    : undefined;
  let result: { readonly transactionHash: string };
  try {
    result = await deps.runtimeRpc.submitInvokeTransaction({
      account: resolved.account.account,
      calls: plan.calls,
      ...(reviewedFee ? { reviewedFee } : {}),
      rpcUrls: resolved.rpcUrls,
      signHash: signerForContext(deps, resolved.account),
    });
  } catch (error) {
    await releaseMultisigOperation(deps, operationId);
    throw error;
  }
  await recordClaimedMultisigSubmission(deps, operationId, {
    accountId: resolved.record.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: resolved.account.networkId,
    summary: plan.summary,
  });
  // An executed proposal runs its inner call AS the multisig, so an allowance
  // it grants is owned by the multisig's scope — not by the signer that paid to
  // broadcast it. Recording it under the signer would file a grant the signer
  // never made and offer a revoke that would zero the wrong account's
  // allowance; recording it here is what lets the manager show the multisig's
  // standing approvals at all.
  if (plan.executed && assets) {
    const { calldata, contractAddress, entrypoint } = plan.executed;
    await recordApproveAllowances({
      assets,
      calls: [{ calldata: [...calldata], contractAddress, entrypoint }],
      owner: allowanceOwner(resolved.record),
      store: deps.allowanceStore,
    });
  }
  return result.transactionHash;
};

/**
 * Looks up a stored proposal by id and resolves the signer context for it, or
 * returns the displayable error the caller returns unchanged.
 */
export const proposalById = async (
  deps: MultisigOpsDeps,
  proposalId: string,
  signerAccountId?: string,
): Promise<{ readonly error: string } | ResolvedProposal> => {
  const proposal = (await deps.multisigStore.listProposals()).find(
    (stored) => stored.id === proposalId,
  );
  if (!proposal) {
    return { error: "proposal not found" };
  }
  const resolved = await resolveMultisigTarget(deps, proposal.multisigId, signerAccountId);
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  return { proposal, resolved };
};

/**
 * The two record-shape guards every authority-GRANTING action runs before it
 * turns a stored id or a stored call into signed calldata. They are
 * complementary: a call-bearing record must hash to its own id, a call-less one
 * needs the out-of-band acknowledgment instead. Returns null when the record is
 * usable. Revocation uses `revokeRecordGuardError` instead — it removes
 * authority and consumes only the id, so an unbound record stays recoverable
 * there rather than being refused.
 */
export const recordGuardError = (
  proposal: MultisigProposalRecord,
  untrackedVerified: boolean | undefined,
): string | null =>
  bindingError(proposal) ?? requireUntrackedVerification(proposal, untrackedVerified);

// A wallet-submitted proposal reading as not-found is kept only while its submit
// transaction is still pending. Once that submit is accepted/rejected, not-found
// is the authoritative chain state and should be persisted.
const persistFreshStatus = async (
  deps: MultisigOpsDeps,
  proposal: MultisigProposalRecord,
  status: MultisigProposalStatus,
  signer: string,
): Promise<void> => {
  if (status.state === "not-found" && (await isProposalSubmitPending(deps, proposal))) {
    return;
  }
  await deps.multisigStore.upsertProposal({
    ...proposal,
    confirmations: status.confirmations,
    confirmedBySigner: status.confirmedBySigner,
    confirmedBySignerAddress: signer,
    confirmedSignerAddresses: confirmedSignersAfterStatus(
      proposal,
      signer,
      status.confirmedBySigner,
    ),
    state: status.state,
  });
};

/**
 * Best-effort status refresh after a broadcast: a failed read leaves the stored
 * record untouched rather than overwriting it with a guess.
 */
export const refreshAfterAction = async (
  deps: MultisigOpsDeps,
  found: ResolvedProposal,
): Promise<void> => {
  const status = await multisigRpc(deps)
    .getProposalStatus({
      address: found.resolved.record.address,
      rpcUrls: found.resolved.rpcUrls,
      signer: found.resolved.account.account.address,
      txId: found.proposal.txId,
    })
    .catch(() => null);
  if (status) {
    await persistFreshStatus(deps, found.proposal, status, found.resolved.account.account.address);
  }
};

/**
 * Reads the proposal's authoritative chain state and persists it, or returns a
 * displayable error. Every action that depends on the proposal's state runs
 * this first rather than trusting the stored snapshot.
 */
export const freshProposalStatus = async (
  deps: MultisigOpsDeps,
  found: ResolvedProposal,
): Promise<{ readonly error: string } | MultisigProposalStatus> => {
  let status: MultisigProposalStatus;
  try {
    status = await multisigRpc(deps).getProposalStatus({
      address: found.resolved.record.address,
      rpcUrls: found.resolved.rpcUrls,
      signer: found.resolved.account.account.address,
      txId: found.proposal.txId,
    });
  } catch {
    return { error: "could not refresh proposal status — try again" };
  }
  await persistFreshStatus(deps, found.proposal, status, found.resolved.account.account.address);
  return status;
};

/**
 * Claims this signer's single in-flight slot for a proposal action, so two
 * panels cannot broadcast the same confirmation twice. The slot is scoped to
 * the watched multisig as well as the transaction id, because that id is a hash
 * of `(call, salt)` alone and the same proposal can exist on two contracts.
 */
export const reserveProposalAction = async (
  deps: MultisigOpsDeps,
  found: ResolvedProposal,
  kind: MultisigProposalOperationKind,
): Promise<{ readonly error: string } | { readonly operationId: string }> =>
  claimMultisigProposalOperation(deps, {
    accountId: found.resolved.account.account.id,
    kind,
    multisigId: found.resolved.record.id,
    networkId: found.resolved.account.networkId,
    pendingError: "this signer already has a proposal action in progress — wait for it to settle",
    txId: found.proposal.txId,
  });
