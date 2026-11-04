/**
 * Dapp invokes from a connected Argent multisig. Threshold 1 with a local
 * signer is signed and submitted under the reviewed fee. A higher threshold
 * is saved as a multisig intent the other signers can finish; nothing is
 * broadcast, and the site is told so.
 */

import { MULTISIG_LIMITS } from "@bramble/multisig/chain";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
  MultisigStore,
} from "@bramble/multisig/repository";
import { argentMultisigIntentId } from "@bramble/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@bramble/starknet/account-contracts";
import { exceedsReviewedFee, type FeeEstimate } from "@bramble/starknet/fee-bounds";
import { preparedArgentMultisigFee } from "@bramble/starknet/multisig-invoke";
import { REVIEWED_FEE_EXCEEDED, REVIEWED_FEE_REQUIRED } from "@bramble/starknet/rpc-submit";
import { activityOrigin } from "@bramble/transactions/activity";
import {
  refuseOnAccountSelfCall,
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import { createApprovalContext } from "../approvals/approval-context";
import { requireApprovalAdmission } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue, PendingApproval } from "../approvals/approvals";
import { PENDING_INVOKE_FEE } from "../approvals/invoke-fee-review";
import type { AccountHashSignerDeps } from "../ledger/account-hash-signer";
import { accountHashSigner } from "../ledger/account-hash-signer";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls, vaultAccountAddresses } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { afterBroadcast, recordSubmittedActivity } from "../transactions/activity-recording";
import { withTrustedRecipients } from "../transactions/trusted-recipients";
import {
  type GrantDeps,
  grantedDappAccounts,
  isGrantedMultisig,
  multisigMemberAccount,
  multisigRecordById,
} from "./dapp-account";
import type { InvokeExecuteDeps } from "./held-invoke-submit";
import { priceMultisigInvoke } from "./multisig-dapp-price";
import { freshSignerConfig, MULTISIG_CLASS } from "./multisig-dapp-sign";
import { invokeFailureResponse } from "./provider-invoke-failure";
/** Error a site receives when a higher-threshold invoke was saved, not sent. */
export const MULTISIG_PROPOSAL_SAVED = "Multisig proposal saved. It was not submitted.";
const PROOF_REFUSAL = "This multisig can't submit a private proof.";
const THRESHOLD_CHANGED = "This multisig changed since this request was reviewed.";

type QueueDeps = {
  readonly activity: Pick<InvokeExecuteDeps["activity"], "list">;
  readonly allowanceStore: InvokeExecuteDeps["allowanceStore"];
  readonly approvals: ApprovalQueue;
  readonly preferencesStore: InvokeExecuteDeps["preferencesStore"];
  readonly runtimeRpc: RuntimeRpc;
  readonly session: InvokeExecuteDeps["session"];
  readonly wallet: InvokeExecuteDeps["wallet"];
};

const intentSummary = (calls: readonly { readonly summary: string }[]): string => {
  const first = calls[0]?.summary ?? "Review transaction";
  const suffix = calls.length > 1 ? ` +${calls.length - 1}` : "";
  return `${first}${suffix}`.slice(0, MULTISIG_LIMITS.summaryLength).trimEnd();
};

const signerGuids = (keys: readonly string[]): string[] =>
  [...keys.map((key) => argentSignerGuid(key))].sort((left, right) =>
    BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0,
  );

/**
 * Queues a multisig invoke and prices it. A private proof is refused: this
 * lane submits an ordinary invoke or saves an intent, and a proof belongs to
 * the private lane.
 */
const queueMultisigDappInvoke = async (
  deps: QueueDeps,
  record: ArgentMultisigRecord,
  input: {
    readonly calls: readonly Call[];
    readonly credential: string;
    readonly isAuthorized: () => boolean;
    readonly origin: string;
    readonly proof?: unknown;
  },
): Promise<{ readonly approval: PendingApproval } | RuntimeResponse> => {
  if (input.proof !== undefined) return { error: PROOF_REFUSAL };
  requireApprovalAdmission(deps.approvals, input.origin);
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    await vaultAccountAddresses(deps.wallet, input.credential),
  );
  const trusted = verificationContext(record, preferences);
  const report = verifyCalls(input.calls, trusted);
  const refusal = refuseOnAccountSelfCall(input.calls, record.address);
  if (refusal) return refusal;
  const threshold = record.currentConfig?.threshold;
  const context = await createApprovalContext(record, { calls: input.calls });
  if (!input.isAuthorized()) return { error: "wallet locked" };
  const approval = deps.approvals.requestInvoke({
    calls: input.calls,
    context,
    fee: PENDING_INVOKE_FEE,
    flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
    ...(threshold !== undefined && threshold > 1 ? { multisigThreshold: threshold } : {}),
    origin: input.origin,
    reviewAssets: trusted.tokens
      .filter((token) => input.calls.some((call) => sameFelt(call.contractAddress, token.address)))
      .map((token) => ({ address: token.address, symbol: token.symbol })),
    summaries: report.calls.map((call) => call.summary),
  });
  notifyApprovalsChanged();
  const revision = deps.approvals.beginFeeEstimate(approval.id);
  if (revision) {
    void priceMultisigInvoke(deps, record, input.calls, preferences).then((fee) => {
      if (deps.approvals.updateFee(revision, { kind: "invoke", review: fee })) {
        notifyApprovalsChanged();
      }
    });
  }
  return { approval };
};

const activitySummary = (origin: string, calls: readonly Call[]): string =>
  `${activityOrigin(origin)} submitted ${calls.length} call${calls.length === 1 ? "" : "s"}`;

/**
 * Queues a multisig invoke when one is the account the site is connected as.
 * Null leaves the single-signer path to run.
 */
export const maybeQueueMultisigInvoke = async (
  deps: QueueDeps & GrantDeps,
  input: {
    readonly calls: readonly Call[];
    readonly origin: string;
    readonly proof?: unknown;
  },
): Promise<{ readonly approval: PendingApproval } | RuntimeResponse | null> => {
  const credential = deps.session.peekPassphrase();
  const authorized = captureSessionAuthorization(deps.session);
  if (!credential) return null;
  const granted = await grantedDappAccounts(deps, input.origin, credential);
  const presented = granted.find((account) => isGrantedMultisig(account));
  if (!presented) return authorized.isCurrent() ? null : { error: "wallet locked" };
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  if (!deps.multisigStore) return { error: "Argent multisig not found" };
  const record = await multisigRecordById(deps.multisigStore, presented.id);
  if (!record) return { error: "Argent multisig not found" };
  return queueMultisigDappInvoke(deps, record, {
    ...input,
    credential,
    isAuthorized: authorized.isCurrent,
  });
};

/**
 * Submits or saves a queued multisig invoke. Null means the approval is not
 * for a multisig.
 */
export const maybeExecuteMultisigInvoke = async (
  deps: InvokeExecuteDeps &
    AccountHashSignerDeps & {
      readonly multisigStore?: Pick<MultisigStore, "listMultisigs" | "upsertIntent">;
    },
  approval: {
    readonly context?: { readonly accountId: string };
    readonly origin: string;
    readonly reviewedFee?: FeeEstimate;
    readonly reviewedThreshold?: number;
  },
  calls: readonly Call[],
): Promise<RuntimeResponse | null> => {
  if (!deps.multisigStore) return null;
  const record = await multisigRecordById(deps.multisigStore, approval.context?.accountId);
  if (!record) return null;
  const credential = deps.session.peekPassphrase();
  if (!credential) return { error: "wallet locked" };
  const authorized = captureSessionAuthorization(deps.session);
  const granted = deps.multisigGrants
    ? await deps.multisigGrants.idsFor(approval.origin, credential)
    : [];
  if (!deps.multisigGrants || !authorized.isCurrent()) {
    return { error: deps.multisigGrants ? "wallet locked" : "origin not connected" };
  }
  if (!granted.includes(record.id)) return { error: "origin not connected" };
  const vault = await deps.wallet.readVault(credential);
  return executeMultisigDappInvoke(
    { ...deps, multisigStore: deps.multisigStore },
    {
      accounts: vault.accounts,
      calls,
      credential,
      origin: approval.origin,
      record,
      ...(approval.reviewedFee ? { reviewedFee: approval.reviewedFee } : {}),
      ...(approval.reviewedThreshold === undefined
        ? {}
        : { reviewedThreshold: approval.reviewedThreshold }),
    },
  );
};

/**
 * Runs a multisig invoke when the approval is one, otherwise `runSigner`.
 */
export const withMultisigInvoke = async (
  deps: Parameters<typeof maybeExecuteMultisigInvoke>[0],
  approval: Parameters<typeof maybeExecuteMultisigInvoke>[1] & {
    readonly payload: { readonly calls?: readonly Call[] };
  },
  runSigner: (calls: readonly Call[]) => Promise<RuntimeResponse>,
): Promise<RuntimeResponse> => {
  const calls = approval.payload.calls;
  if (!calls) return { error: "approval not found" };
  return (await maybeExecuteMultisigInvoke(deps, approval, calls)) ?? runSigner(calls);
};

/**
 * Re-prices a queued multisig invoke. Null when the approval is not one.
 */
export const maybeRetryMultisigFee = async (
  deps: QueueDeps & { readonly multisigStore?: Pick<MultisigStore, "listMultisigs"> },
  approval: { readonly context?: { readonly accountId: string }; readonly id: string },
  calls: readonly Call[],
): Promise<RuntimeResponse | null> => {
  if (!deps.multisigStore) return null;
  const record = await multisigRecordById(deps.multisigStore, approval.context?.accountId);
  if (!record) return null;
  const credential = deps.session.peekPassphrase();
  if (!credential) return { error: "wallet locked" };
  const revision = deps.approvals.beginFeeEstimate(approval.id);
  if (
    !revision ||
    !deps.approvals.updateFee(revision, { kind: "invoke", review: PENDING_INVOKE_FEE })
  ) {
    return { error: "approval not found" };
  }
  notifyApprovalsChanged();
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    await vaultAccountAddresses(deps.wallet, credential),
  );
  const fee = await priceMultisigInvoke(deps, record, calls, preferences);
  if (!deps.approvals.updateFee(revision, { kind: "invoke", review: fee })) {
    return { error: "a newer fee estimate replaced this one" };
  }
  notifyApprovalsChanged();
  return { ok: true };
};

/**
 * Approves a queued multisig invoke. Threshold 1 submits. A higher threshold
 * stores an intent and reports {@link MULTISIG_PROPOSAL_SAVED} to the site.
 */
const executeMultisigDappInvoke = async (
  deps: InvokeExecuteDeps &
    AccountHashSignerDeps & {
      readonly approvals?: ApprovalQueue;
      readonly multisigStore: Pick<MultisigStore, "upsertIntent">;
      readonly runtimeRpc: RuntimeRpc;
    },
  input: {
    readonly accounts: readonly AccountRef[];
    readonly calls: readonly Call[];
    readonly credential: string;
    readonly origin: string;
    readonly record: ArgentMultisigRecord;
    readonly reviewedFee?: FeeEstimate;
    readonly reviewedThreshold?: number;
  },
): Promise<RuntimeResponse> => {
  if (!input.record.currentConfig) {
    return { error: "This multisig's signers aren't available yet." };
  }
  const config = input.record.currentConfig;
  if ((input.reviewedThreshold ?? 1) !== config.threshold) {
    return { error: THRESHOLD_CHANGED };
  }
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    await vaultAccountAddresses(deps.wallet, input.credential),
  );
  const trusted = verificationContext(input.record, preferences);
  const report = verifyCalls(input.calls, trusted);
  const refusal =
    refuseOnAccountSelfCall(input.calls, input.record.address) ?? refuseOnPoisonedRecipient(report);
  if (refusal) return refusal;
  // The stored threshold is what the card reviewed; the chain must still agree,
  // or a "saved for signers" signature could already be enough to submit.
  const changed = await freshSignerConfig(
    deps.runtimeRpc,
    input.record.address,
    config,
    networkRpcUrls(STARKNET_NETWORKS[input.record.networkId], preferences),
  );
  if (changed) return changed;
  const member = multisigMemberAccount(
    input.accounts,
    config.signerPublicKeys,
    input.record.networkId,
  );
  const authorized = captureSessionAuthorization(deps.session);
  if (config.threshold === 1) {
    if (!member) return { error: "This wallet doesn't hold a signer for this multisig." };
    return submitThresholdOne(deps, input, member, preferences, authorized.isCurrent);
  }
  return saveProposal(
    deps,
    input,
    member,
    report.calls,
    authorized.isCurrent,
    preferences,
    input.reviewedFee,
  );
};

const submitThresholdOne = async (
  deps: AccountHashSignerDeps &
    Pick<InvokeExecuteDeps, "activity" | "allowanceStore" | "preferencesStore" | "runtimeRpc">,
  input: {
    readonly calls: readonly Call[];
    readonly credential: string;
    readonly origin: string;
    readonly record: ArgentMultisigRecord;
    readonly reviewedFee?: FeeEstimate;
  },
  member: AccountRef,
  preferences: Awaited<ReturnType<InvokeExecuteDeps["preferencesStore"]["read"]>>,
  isAuthorized: () => boolean,
): Promise<RuntimeResponse> => {
  const submit = deps.runtimeRpc.submitMultisigDappInvoke;
  const config = input.record.currentConfig;
  if (!submit || !config || !input.reviewedFee) {
    return {
      error:
        "The network fee was not reviewed. Nothing was submitted — review the transaction again.",
    };
  }
  let signedHash: string | undefined;
  const summary = activitySummary(input.origin, input.calls);
  const recordPending = async (hash: string): Promise<void> => {
    await recordApproveAllowances({
      assets: verificationContext(input.record, preferences),
      calls: input.calls,
      owner: allowanceOwner(input.record),
      store: deps.allowanceStore,
      transactionHash: hash,
    });
    await recordSubmittedActivity(deps.activity, {
      accountId: input.record.id,
      hash,
      kind: "invoke",
      networkId: input.record.networkId,
      summary,
    });
  };
  try {
    const result = await submit({
      account: input.record,
      calls: input.calls,
      config,
      isAuthorized,
      onSigned: async (signed) => {
        signedHash = signed.transactionHash;
      },
      reviewedFee: input.reviewedFee,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[input.record.networkId], preferences),
      signHash: accountHashSigner(deps, member, input.credential),
    });
    await afterBroadcast(() => recordPending(result.transactionHash));
    return { ok: true, transactionHash: result.transactionHash };
  } catch (error) {
    return invokeFailureResponse(error, false, signedHash, recordPending, async () => undefined);
  }
};

const preparedProposalRefusal = async (
  deps: { readonly runtimeRpc: Pick<RuntimeRpc, "getClassHashAt"> },
  record: ArgentMultisigRecord,
  prepared: Parameters<typeof preparedArgentMultisigFee>[0],
  reviewedFee: FeeEstimate | undefined,
  rpcUrls: readonly string[],
): Promise<RuntimeResponse | null> => {
  const live = await deps.runtimeRpc.getClassHashAt?.({ address: record.address, rpcUrls });
  if (!live || !sameFelt(live, ARGENT_MULTISIG_CONTRACT.classHash)) {
    return { error: MULTISIG_CLASS };
  }
  if (!reviewedFee) return { error: REVIEWED_FEE_REQUIRED };
  let quoted: FeeEstimate;
  try {
    quoted = preparedArgentMultisigFee(prepared);
  } catch {
    return { error: "This transaction could not be saved for the signers." };
  }
  return exceedsReviewedFee(reviewedFee, quoted) ? { error: REVIEWED_FEE_EXCEEDED } : null;
};

const saveProposal = async (
  deps: AccountHashSignerDeps & {
    readonly multisigStore: Pick<MultisigStore, "upsertIntent">;
    readonly runtimeRpc: Pick<RuntimeRpc, "getClassHashAt" | "multisig">;
  },
  input: {
    readonly calls: readonly Call[];
    readonly credential: string;
    readonly record: ArgentMultisigRecord;
  },
  member: AccountRef | null,
  reviewedCalls: readonly { readonly summary: string }[],
  isAuthorized: () => boolean,
  preferences: Awaited<ReturnType<InvokeExecuteDeps["preferencesStore"]["read"]>>,
  reviewedFee: FeeEstimate | undefined,
): Promise<RuntimeResponse> => {
  const prepare = deps.runtimeRpc.multisig?.prepareInvoke;
  const config = input.record.currentConfig;
  if (!prepare || !config) return { error: "This multisig's signers aren't available yet." };
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.record.networkId], preferences);
  const prepared = await prepare({
    account: input.record,
    calls: input.calls.map((call) => ({
      calldata: Array.isArray(call.calldata) ? call.calldata.map((item) => String(item)) : [],
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
    })),
    config,
    rpcUrls,
  });
  const id = argentMultisigIntentId(input.record.id, prepared.transactionHash);
  if (!id) return { error: "This transaction could not be saved for the signers." };
  const blocked = await preparedProposalRefusal(deps, input.record, prepared, reviewedFee, rpcUrls);
  if (blocked || !isAuthorized()) {
    return blocked ?? { error: "wallet locked" };
  }
  const signed = member
    ? [await accountHashSigner(deps, member, input.credential)(prepared.transactionHash)]
    : [];
  const intent: ArgentMultisigSigningIntent = {
    accountId: input.record.id,
    configSnapshot: {
      classHash: input.record.classHash,
      signerGuids: signerGuids(config.signerPublicKeys),
      threshold: config.threshold,
    },
    id,
    prepared,
    signatures: signed,
    state: signed.length === config.threshold ? "ready" : "collecting",
    summary: intentSummary(reviewedCalls),
  };
  const stored = await deps.multisigStore.upsertIntent(intent, isAuthorized);
  if (stored === "unauthorized") return { error: "wallet locked" };
  if (stored !== "stored") return { error: "This transaction could not be saved for the signers." };
  return { error: MULTISIG_PROPOSAL_SAVED };
};
