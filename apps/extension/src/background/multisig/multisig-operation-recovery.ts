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
 * Files a broadcast, or possibly broadcast, intent under `transactionHash`: its
 * grants first, then its activity line, as every submitting path does (see
 * ../portfolio/allowance-recording). Best-effort: a failed read or write leaves
 * a local row missing and never reaches the caller, whose reply carries the
 * hash either way.
 */
export const recordBroadcastIntent = async (
  deps: Pick<MultisigOpsDeps, "activity" | "allowanceStore" | "preferencesStore">,
  intent: ArgentMultisigSigningIntent,
  record: ArgentMultisigRecord,
  transactionHash: string,
): Promise<void> => {
  await deps.preferencesStore
    .read()
    .then((preferences) =>
      recordApproveAllowances({
        assets: verificationContext(record, preferences),
        calls: normalizedArgentMultisigCalls(intent.prepared.calls),
        owner: allowanceOwner(record),
        store: deps.allowanceStore,
        transactionHash,
      }),
    )
    .catch(() => {});
  await recordSubmittedIntentActivity(deps, intent, record.networkId, transactionHash);
};

/**
 * Outcome of checking an exact deterministic submit hash.
 */
export type ArgentSubmitResolution =
  | { readonly intent: ArgentMultisigSigningIntent; readonly kind: "submitted" }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" };

type ObservedSubmission =
  | {
      readonly kind: "found";
      readonly preferences: Awaited<ReturnType<MultisigOpsDeps["preferencesStore"]["read"]>>;
      readonly record: ArgentMultisigRecord;
      /** The node reported a real finality status, not just an odd answer. */
      readonly seen: boolean;
      readonly state: "accepted" | "rejected" | "submitted";
    }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" };

// Asks the chain about the intent's exact signed hash. Every signer holds the
// same signed package, so a co-signer's broadcast has this hash too.
const observeSignedHash = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
): Promise<ObservedSubmission> => {
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
  return { kind: "found", preferences, record, seen: report.seen, state };
};

const journalObservedSubmission = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
  observed: Extract<ObservedSubmission, { readonly kind: "found" }>,
): Promise<void> => {
  await recordApproveAllowances({
    assets: verificationContext(observed.record, observed.preferences),
    calls: normalizedArgentMultisigCalls(intent.prepared.calls),
    owner: allowanceOwner(observed.record),
    store: deps.allowanceStore,
    transactionHash: intent.prepared.transactionHash,
  });
  await recordSubmittedIntentActivity(
    deps,
    intent,
    observed.record.networkId,
    intent.prepared.transactionHash,
  );
};

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
  const observed = await observeSignedHash(deps, intent);
  if (observed.kind !== "found") return observed;
  const recovered: ArgentMultisigSigningIntent = {
    ...intent,
    broadcastTransactionHash: intent.prepared.transactionHash,
    state: observed.state,
  };
  await deps.multisigStore
    .setOperationHash(operationId, intent.prepared.transactionHash)
    .catch(() => {});
  await deps.multisigStore.upsertIntent(recovered).catch(() => "invalid" as const);
  await journalObservedSubmission(deps, intent, observed);
  return { intent: recovered, kind: "submitted" };
};

/**
 * Recovers a fully signed stale intent that was broadcast anyway: by a
 * co-signer holding the same signed package, or by a write endpoint that
 * forwarded it and then answered with a fee rejection (Sherlock 177). Found on
 * chain, it moves to `submitted` with its signed hash and joins activity, so
 * the ordinary outcome reconciliation settles it and no screen offers to send
 * the same calls again. Only a positive chain observation moves it; a failed
 * read is `unknown` and leaves it stale.
 */
export const recoverStaleArgentIntent = async (
  deps: MultisigOpsDeps,
  intent: ArgentMultisigSigningIntent,
): Promise<ArgentSubmitResolution> => {
  if (intent.state !== "stale" || intent.signatures.length !== intent.configSnapshot.threshold) {
    return { kind: "absent" };
  }
  const observed = await observeSignedHash(deps, intent);
  if (observed.kind !== "found") return observed;
  // `found` without `seen` is an odd answer, not a sighting: it proves nothing.
  if (!observed.seen) return { kind: "unknown" };
  // A stale intent may only move to `submitted`; the outcome follows from there.
  const submitted: ArgentMultisigSigningIntent = {
    ...intent,
    broadcastTransactionHash: intent.prepared.transactionHash,
    state: "submitted",
  };
  // Journal first: recording a hash replaces any entry with the same hash, so
  // a retry after a failed state write repeats it harmlessly, while the other
  // order could leave a `submitted` intent with no activity to settle it.
  await journalObservedSubmission(deps, intent, observed);
  if ((await deps.multisigStore.upsertIntent(submitted).catch(() => "invalid")) !== "stored") {
    return { kind: "unknown" };
  }
  return { intent: submitted, kind: "submitted" };
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
