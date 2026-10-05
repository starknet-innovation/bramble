/** Trusted-evidence recovery for durable Argent operation claims with no local hash. */
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import { verificationContext } from "@bramble/transactions/verify";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { networkRpcUrls } from "../runtime/runtime-state";
import { paidCounterparty, recordSubmittedActivity } from "../transactions/activity-recording";
import type { MultisigOpsDeps } from "./multisig-deps";
import { normalizedArgentMultisigCalls } from "./multisig-inputs";

/**
 * Journals a broadcast Argent intent. A single-call payment records its payee
 * as the counterparty so the recipient joins the paid-recipient trust set like
 * an ERC20 send's (audit #163); the call set was already reviewed against the
 * poisoning rule before it could be signed.
 */
export const recordSubmittedIntentActivity = (
  deps: Pick<MultisigOpsDeps, "activity">,
  intent: ArgentMultisigSigningIntent,
  networkId: ArgentMultisigRecord["networkId"],
  transactionHash: string,
): Promise<void> =>
  recordSubmittedActivity(deps.activity, {
    accountId: intent.accountId,
    ...paidCounterparty(normalizedArgentMultisigCalls(intent.prepared.calls)),
    hash: transactionHash,
    kind: "invoke",
    networkId,
    summary: intent.summary,
  });

/**
 * Outcome of checking an exact deterministic submit hash.
 */
export type ArgentSubmitResolution =
  | { readonly intent: ArgentMultisigSigningIntent; readonly kind: "submitted" }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" };

/**
 * Recovers an unresolved submit only from a fresh chain observation of its
 * exact deterministic hash. A successful not-found response is distinct from
 * a failed read so the caller may safely retry only the same frozen payload.
 */
export const recoverSubmittedArgentIntent = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  operationId: string,
): Promise<ArgentSubmitResolution> => {
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === intent.accountId,
  );
  if (!record) return { kind: "unknown" };
  const preferences = await deps.preferencesStore.read();
  let reports: Awaited<ReturnType<MultisigOpsDeps["runtimeRpc"]["getTransactionStatuses"]>>;
  try {
    reports = await deps.runtimeRpc.getTransactionStatuses({
      hashes: [intent.prepared.transactionHash],
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
    });
  } catch {
    return { kind: "unknown" };
  }
  const report = Object.entries(reports).find(([hash]) =>
    sameFelt(hash, intent.prepared.transactionHash),
  )?.[1];
  if (!report?.found) return { kind: "absent" };
  const state =
    report.status === "accepted"
      ? "accepted"
      : report.status === "rejected" || report.status === "reverted"
        ? "rejected"
        : "submitted";
  const recovered: ArgentMultisigSigningIntent = {
    ...intent,
    broadcastTransactionHash: intent.prepared.transactionHash,
    state,
  };
  await deps.multisigStore
    .setOperationHash(operationId, intent.prepared.transactionHash)
    .catch(() => {});
  await deps.multisigStore.upsertIntent(recovered).catch(() => "invalid" as const);
  await recordApproveAllowances({
    assets: verificationContext(record, preferences),
    calls: normalizedArgentMultisigCalls(intent.prepared.calls),
    owner: allowanceOwner(record),
    store: deps.allowanceStore,
  });
  await recordSubmittedIntentActivity(
    deps,
    intent,
    record.networkId,
    intent.prepared.transactionHash,
  );
  return { intent: recovered, kind: "submitted" };
};

/**
 * What a claimed deployment turned out to be. `absent` is a POSITIVE finding —
 * the chain says nothing was deployed at the counterfactual address — and is
 * what lets a stuck claim be released; `unknown` is the honest "cannot tell".
 */
export type ArgentDeploymentResolution =
  | { readonly kind: "deployed"; readonly transactionHash: string | null }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" };

/**
 * Resolves a claimed deployment without ever rebroadcasting.
 *
 * Local activity is consulted first, because it is the only place the exact
 * transaction hash can come from. When it holds nothing — the case after a
 * submit whose response was lost, which is exactly when this runs — the chain is
 * asked instead: a deployment address is fully determined by class hash, salt,
 * and constructor calldata, so its existence answers the question the missing
 * hash cannot. A definitive "not deployed" is reported so the caller can release
 * the claim; only a failed read stays `unknown`.
 */
export const resolveArgentDeployment = async (
  deps: MultisigOpsDeps,
  record: ArgentMultisigRecord,
  operationId: string,
): Promise<ArgentDeploymentResolution> => {
  const entry = (await deps.activity.list()).find(
    (candidate) =>
      candidate.accountId === record.id &&
      candidate.networkId === record.networkId &&
      candidate.kind === "deploy",
  );
  const hash = entry ? canonicalFelt(entry.hash) : null;
  if (hash && BigInt(hash) !== 0n) {
    await deps.multisigStore.setOperationHash(operationId, hash).catch(() => {});
    return { kind: "deployed", transactionHash: hash };
  }
  const preferences = await deps.preferencesStore.read();
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({
      accountAddress: record.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
    })
    .then(
      (value) => value,
      // A read that failed proves nothing either way, and guessing here would
      // either strand a live account or release a claim over a real deployment.
      () => null,
    );
  if (deployed === null) return { kind: "unknown" };
  return deployed ? { kind: "deployed", transactionHash: null } : { kind: "absent" };
};
