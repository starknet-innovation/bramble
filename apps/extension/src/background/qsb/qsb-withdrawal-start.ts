/**
 * `wallet.quoteQsbWithdrawal` and `wallet.startQsbWithdrawal`: the quote, and
 * fixing the withdrawal's terms and starting the coordinator's search.
 *
 * Order (qsb-app `sdk/client.ts` `createWithdrawal`, the spec's §1 and §7):
 * the user's grant first; the terms quoted again, whose fee must be the one
 * the user accepted (`quoteChanged`); the configuration's solver release; no
 * job of the coordinator's for this vault; then the intent — canonical
 * manifest, its hash, the frozen helper, destination, fee, payout and a
 * fresh job id — kept durably, and only then `POST /v1/jobs`, whose answer
 * must name this very job and manifest hash. A vault gets one job, ever, and
 * an intent is never replaced: a retry after a lost or retryable answer
 * sends the same manifest again, at the same fee, provided the floor and
 * the solver have not moved. A final refusal (`withdrawal_invalid`,
 * `invalid_request`, `idempotency_conflict`, `state_conflict`,
 * `solver_not_served`) is kept as refused and answers `jobRefused`.
 */
import { QsbCoordinatorFailure } from "@bramble/qsb/client";
import { qsbWithdrawalVsize } from "@bramble/qsb/fees";
import {
  type QsbWithdrawalManifest,
  qsbManifestHash,
  qsbManifestJson,
  readQsbManifest,
} from "@bramble/qsb/withdrawal-manifest";
import type { QsbJob } from "@bramble/qsb/withdrawal-responses";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type { QsbWithdrawalQuote } from "@bramble/wallet-model/qsb-withdrawals";
import { requireCoordinatorAccess, requireWithdrawalsOpen } from "./qsb-vault-gates";
import { minerFloorMsat, type QsbDepositContext } from "./qsb-vault-prepare";
import { failClosed, withdrawalRefusal } from "./qsb-vault-refusals";
import { type QsbVaultDeps, qsbAccessSession, qsbOwnerOf } from "./qsb-vault-session";
import { qsbVaultView } from "./qsb-vault-view";
import {
  intendedQuote,
  keptWithdrawals,
  payableDestination,
  type QsbWithdrawalTerms,
  withdrawableRecord,
  withdrawalTerms,
} from "./qsb-withdrawal-terms";

// The coordinator's job refusals that are final for this manifest.
const FINAL_JOB_CODES: ReadonlySet<string> = new Set([
  "idempotency_conflict",
  "invalid_request",
  "solver_not_served",
  "state_conflict",
  "withdrawal_invalid",
]);

/**
 * Every withdrawal flow's context, the user's grant checked before anything
 * else; `minRemainingMs` keeps a session only while it lives that long.
 */
export const withdrawalContext = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  minRemainingMs = 0,
): Promise<QsbDepositContext> => {
  await requireCoordinatorAccess(deps);
  const owner = await qsbOwnerOf(access);
  return { access, deps, owner, session: qsbAccessSession(deps, access, owner, minRemainingMs) };
};

const heldFor = async (
  access: QsbVaultAccess,
  v: number,
): Promise<QsbWithdrawalRecord | undefined> =>
  (await keptWithdrawals(access)).find((held) => held.v === v);

/**
 * What withdrawing deposit `v` to `destination` pays and costs now: an
 * intent already kept for that destination answers with its own terms.
 */
export const quoteQsbWithdrawal = (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  request: { readonly destination: string; readonly v: number },
): Promise<QsbWithdrawalQuote> =>
  failClosed("runtimeUnavailable", async () => {
    const context = await withdrawalContext(deps, access);
    const held = await heldFor(access, request.v);
    if (!held) return (await withdrawalTerms(context, request)).quote;
    payableDestination(request.destination);
    if (held.destination !== request.destination || held.signed || held.outcome === "refused") {
      throw withdrawalRefusal("notWithdrawable");
    }
    return intendedQuote(held);
  });

const isFinalRefusal = (error: unknown): boolean =>
  error instanceof QsbCoordinatorFailure &&
  error.kind === "refused" &&
  error.code !== null &&
  FINAL_JOB_CODES.has(error.code);

// The manifest a fresh intent sends, in the schema's order.
const manifestOf = (terms: QsbWithdrawalTerms, jobId: string): QsbWithdrawalManifest => ({
  vaultId: terms.server.id,
  funding: {
    txid: terms.record.funding.txid,
    vout: terms.record.funding.vout,
    value: String(terms.record.funding.valueSat),
  },
  helper: {
    txid: terms.helper.txid,
    vout: terms.helper.vout,
    value: String(terms.helper.valueSat),
  },
  destination: terms.destination.address,
  outputScript: terms.destination.outputScript,
  outputValue: String(terms.quote.outputSat),
  fee: String(terms.quote.feeSat),
  idempotencyKey: jobId,
  costAccepted: true,
  solverReleaseId: terms.solverReleaseId,
});

// Sends the kept intent's manifest; the answer must be this very job.
const createJob = async (
  context: QsbDepositContext,
  held: QsbWithdrawalRecord,
  manifest: QsbWithdrawalManifest,
): Promise<void> => {
  let job: QsbJob;
  try {
    job = await context.session.call((token) =>
      context.deps.coordinator.createJob(token, manifest),
    );
  } catch (error) {
    if (!isFinalRefusal(error)) throw error;
    await context.access.recordWithdrawalOutcome(held.v, "refused");
    throw withdrawalRefusal("jobRefused");
  }
  if (job.id !== held.jobId || job.manifestHash !== held.manifestHash) {
    throw withdrawalRefusal("jobRefused");
  }
  await context.access.markWithdrawalJob(held.v);
};

// A fresh intent: kept durably before its job exists.
const freshIntent = async (
  context: QsbDepositContext,
  request: { readonly destination: string; readonly feeSat: number; readonly v: number },
): Promise<{ readonly held: QsbWithdrawalRecord; readonly manifest: QsbWithdrawalManifest }> => {
  const { access, deps, session } = context;
  const terms = await withdrawalTerms(context, request);
  if (terms.quote.feeSat !== request.feeSat) throw withdrawalRefusal("quoteChanged");
  const jobs = await session.call((token) => deps.coordinator.jobs(token));
  if (jobs.some((job) => job.vaultId === terms.server.id)) {
    throw withdrawalRefusal("notWithdrawable");
  }
  const manifest = manifestOf(terms, deps.drawJobId());
  const manifestJson = qsbManifestJson(manifest);
  if (manifestJson === null) throw withdrawalRefusal("destinationInvalid");
  const held: QsbWithdrawalRecord = {
    destination: terms.destination.address,
    feeSat: terms.quote.feeSat,
    helper: terms.helper,
    jobCreated: false,
    jobId: manifest.idempotencyKey,
    manifestHash: qsbManifestHash(manifestJson),
    manifestJson,
    outcome: null,
    outputSat: terms.quote.outputSat,
    signed: null,
    v: request.v,
  };
  await access.holdWithdrawal(held);
  return { held, manifest };
};

// An intent already kept: the same manifest again, if nothing has moved.
const keptIntent = async (
  context: QsbDepositContext,
  held: QsbWithdrawalRecord,
  request: { readonly destination: string; readonly feeSat: number },
): Promise<QsbWithdrawalManifest> => {
  if (held.destination !== request.destination || held.feeSat !== request.feeSat) {
    throw withdrawalRefusal("quoteChanged");
  }
  if (held.signed || held.outcome === "refused") throw withdrawalRefusal("notWithdrawable");
  const manifest = readQsbManifest(JSON.parse(held.manifestJson));
  if (!manifest) throw withdrawalRefusal("notWithdrawable");
  const release = requireWithdrawalsOpen(await context.deps.coordinator.config());
  if (manifest.solverReleaseId !== release) throw withdrawalRefusal("jobRefused");
  const vsize = qsbWithdrawalVsize(manifest.outputScript.length / 2);
  if ((BigInt(held.feeSat) * 1000n) / BigInt(vsize) < (await minerFloorMsat(context.deps))) {
    throw withdrawalRefusal("floorRisen");
  }
  return manifest;
};

/**
 * Fixes deposit `v`'s withdrawal at `feeSat` to `destination` and starts the
 * search. Answers the deposit with its withdrawal `searching`.
 */
export const startQsbWithdrawal = (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  request: { readonly destination: string; readonly feeSat: number; readonly v: number },
): Promise<QsbVaultView> =>
  failClosed("runtimeUnavailable", async () => {
    const context = await withdrawalContext(deps, access);
    const kept = await heldFor(access, request.v);
    const started = kept
      ? { held: kept, manifest: await keptIntent(context, kept, request) }
      : await freshIntent(context, request);
    await createJob(context, started.held, started.manifest);
    const record = await withdrawableRecord(access, request.v);
    return qsbVaultView(record, undefined, null, {
      confirmations: null,
      destination: started.held.destination,
      feeSat: started.held.feeSat,
      outputSat: started.held.outputSat,
      status: "searching",
      txid: null,
    });
  });
