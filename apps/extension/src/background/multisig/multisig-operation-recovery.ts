/** Trusted-evidence recovery for durable Argent operation claims with no local hash. */
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@mc-wallet/multisig/repository";
import { verificationContext } from "@mc-wallet/transactions/verify";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import { allowanceOwner, recordApproveAllowances } from "../portfolio/allowance-recording";
import { networkRpcUrls } from "../runtime/runtime-state";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import type { MultisigOpsDeps } from "./multisig-deps";
import { normalizedArgentMultisigCalls } from "./multisig-inputs";

/**
 * Recovers an unresolved submit only from a fresh chain observation of its
 * exact deterministic hash. Missing or failed evidence returns null and never retries a write.
 */
export const recoverSubmittedArgentIntent = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  operationId: string,
): Promise<ArgentMultisigSigningIntent | null> => {
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === intent.accountId,
  );
  if (!record) return null;
  const preferences = await deps.preferencesStore.read();
  const reports = await deps.runtimeRpc
    .getTransactionStatuses({
      hashes: [intent.prepared.transactionHash],
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
    })
    .catch(() => ({}));
  const report = Object.entries(reports).find(([hash]) =>
    sameFelt(hash, intent.prepared.transactionHash),
  )?.[1];
  if (!report?.found) return null;
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
  await recordSubmittedActivity(deps.activity, {
    accountId: intent.accountId,
    hash: intent.prepared.transactionHash,
    kind: "invoke",
    networkId: record.networkId,
    summary: intent.summary,
  });
  return recovered;
};

/**
 * Recovers a deployment hash only from the wallet's validated local activity
 * journal. Missing or malformed evidence returns null and never rebroadcasts.
 */
export const recoverArgentDeploymentHash = async (
  deps: MultisigOpsDeps,
  record: ArgentMultisigRecord,
  operationId: string,
): Promise<string | null> => {
  const entry = (await deps.activity.list()).find(
    (candidate) =>
      candidate.accountId === record.id &&
      candidate.networkId === record.networkId &&
      candidate.kind === "deploy",
  );
  const hash = entry ? canonicalFelt(entry.hash) : null;
  if (!hash || BigInt(hash) === 0n) return null;
  await deps.multisigStore.setOperationHash(operationId, hash).catch(() => {});
  return hash;
};
