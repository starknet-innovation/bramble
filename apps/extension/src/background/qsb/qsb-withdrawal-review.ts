/**
 * `wallet.reviewQsbWithdrawal`: the release review the BIP requires before
 * any secret leaves, built from `T` and the previous transactions Bramble
 * verified itself — never from what the coordinator says the values are.
 *
 * In order, on a session that lives at least 15 more minutes: the job must be
 * `awaiting_authorization` with no transaction yet (`notReady`); the solved
 * result must name this job, this vault and this manifest, which must be the
 * intent kept here byte for byte; the funding's and the helper's previous
 * transactions must hash to their txids and pay the vault script (with the
 * journal's value) and the owner's P2WPKH (with the helper's value); the
 * vault rebuilt from fresh commitments must be the journal's and the
 * coordinator's; then the pinned pipeline's `prepare`, whose `T` must be the
 * one Bramble rebuilds byte for byte from the manifest and the solution,
 * with the sequence and locktime in the ranges submission accepts, the
 * sorted-prefix indices and the vault's script hash; then Krusty's digest.
 * Every failure but an unreachable coordinator is `bindingRefused`, and
 * nothing is disclosed. `binding` is always `unverified`: Bramble checks `T`,
 * but not the QSB puzzle that ties the indices to it.
 *
 * `custody` is the account's: `conformant` for the writer, whose deposit must
 * be `allocated` (or `exposed`, for an exact retry); `emergency` for a
 * read-only account, whose deposit must be `unknown` (a recovered one, with
 * or without its own emergency disclosure, for an exact retry). The release
 * must echo it.
 */
import { bytesToHex } from "@bramble/core/hex";
import { QsbCoordinatorFailure } from "@bramble/qsb/client";
import { qsbWithdrawalVsize } from "@bramble/qsb/fees";
import { ownerP2wpkhScript } from "@bramble/qsb/transactions";
import type { QsbPublicVault } from "@bramble/qsb/vault-responses";
import {
  isQsbDisclosureOf,
  isQsbSolutionInRange,
  type QsbSolution,
  qsbPreviousOutput,
  qsbSolutionJson,
  qsbWithdrawalTransaction,
} from "@bramble/qsb/withdrawal-binding";
import { qsbDestination } from "@bramble/qsb/withdrawal-destination";
import {
  type QsbWithdrawalManifest,
  qsbManifestHash,
  qsbManifestJson,
  readQsbManifest,
} from "@bramble/qsb/withdrawal-manifest";
import type { QsbJob, QsbSolvedResult } from "@bramble/qsb/withdrawal-responses";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import {
  QSB_DISCLOSED_SECRETS,
  type QsbCustody,
  type QsbWithdrawalReview,
} from "@bramble/wallet-model/qsb-withdrawals";
import type { QsbDepositContext } from "./qsb-vault-prepare";
import {
  coordinatorRefusal,
  failClosedWith,
  journalUnavailable,
  withdrawalRefusal,
} from "./qsb-vault-refusals";
import { rebuildQsbVault } from "./qsb-vault-script";
import { QSB_FRESH_SESSION_MS, type QsbVaultDeps } from "./qsb-vault-session";
import type { QsbPreparedWithdrawal } from "./qsb-withdrawal-assembly";
import { withdrawalContext } from "./qsb-withdrawal-start";
import {
  keptWithdrawals,
  type QsbWithdrawableRecord,
  withdrawableRecord,
} from "./qsb-withdrawal-terms";

/** A checked withdrawal, ready for release: the review and everything it was built from. */
export type QsbReviewedWithdrawal = {
  readonly context: QsbDepositContext;
  readonly fundingPreviousTxHex: string;
  readonly held: QsbWithdrawalRecord;
  readonly helperPreviousTxHex: string;
  readonly manifest: QsbWithdrawalManifest;
  readonly prepared: QsbPreparedWithdrawal;
  readonly record: QsbWithdrawableRecord;
  readonly review: QsbWithdrawalReview;
  readonly solution: QsbSolution;
};

const refuse = (): never => {
  throw withdrawalRefusal("bindingRefused");
};

// The job, refused unless it is awaiting the user's authorization with no
// transaction yet.
const readyJob = async (context: QsbDepositContext, held: QsbWithdrawalRecord): Promise<QsbJob> => {
  const jobs = await context.session.call((token) => context.deps.coordinator.jobs(token));
  const job = jobs.find((listed) => listed.id === held.jobId);
  if (job?.status !== "awaiting_authorization" || job.txid !== null) {
    throw withdrawalRefusal("notReady");
  }
  return job;
};

// The solved result, refused unless it is this job's, for the intent kept here.
const boundSolution = (
  held: QsbWithdrawalRecord,
  job: QsbJob,
  solved: QsbSolvedResult,
): QsbSolution => {
  const manifestJson = qsbManifestJson(solved.manifest);
  if (
    qsbManifestHash(held.manifestJson) !== held.manifestHash ||
    manifestJson !== held.manifestJson ||
    qsbManifestJson(job.manifest) !== held.manifestJson ||
    solved.manifestHash !== held.manifestHash ||
    job.manifestHash !== held.manifestHash ||
    solved.jobId !== held.jobId ||
    solved.vaultId !== job.vaultId ||
    solved.manifest.vaultId !== job.vaultId ||
    solved.manifest.idempotencyKey !== held.jobId
  ) {
    refuse();
  }
  return solved.solution;
};

// Both previous outputs, as their own transactions say.
const previousTransactions = async (
  context: QsbDepositContext,
  manifest: QsbWithdrawalManifest,
  record: QsbWithdrawableRecord,
  server: QsbPublicVault,
): Promise<{ readonly funding: string; readonly helper: string }> => {
  const { deps, owner, session } = context;
  const funding = await session.call((token) => deps.coordinator.funding(token, server.id));
  const helper = await session.call((token) =>
    deps.coordinator.paymentInput(token, {
      txid: manifest.helper.txid,
      valueSat: Number(manifest.helper.value),
      vout: manifest.helper.vout,
    }),
  );
  const vaultOutput = qsbPreviousOutput(
    funding.previousTxHex,
    record.funding.txid,
    record.funding.vout,
  );
  const helperOutput = qsbPreviousOutput(
    helper.previousTxHex,
    manifest.helper.txid,
    manifest.helper.vout,
  );
  const ownerScript = ownerP2wpkhScript(owner.address);
  if (
    !vaultOutput ||
    vaultOutput.script !== record.scriptPubKey ||
    vaultOutput.amountSat !== BigInt(record.funding.valueSat) ||
    !helperOutput ||
    ownerScript === null ||
    helperOutput.script !== bytesToHex(ownerScript) ||
    helperOutput.amountSat !== BigInt(manifest.helper.value)
  ) {
    refuse();
  }
  return { funding: funding.previousTxHex, helper: helper.previousTxHex };
};

// The manifest's funding, helper and payout are the journal's, the kept
// intent's and Bramble's own script for the destination.
const isManifestOfIntent = (
  manifest: QsbWithdrawalManifest,
  held: QsbWithdrawalRecord,
  record: QsbWithdrawableRecord,
): boolean =>
  manifest.funding.txid === record.funding.txid &&
  manifest.funding.vout === record.funding.vout &&
  manifest.funding.value === String(record.funding.valueSat) &&
  manifest.helper.txid === held.helper.txid &&
  manifest.helper.vout === held.helper.vout &&
  manifest.helper.value === String(held.helper.valueSat) &&
  manifest.destination === held.destination &&
  qsbDestination(manifest.destination)?.outputScript === manifest.outputScript &&
  manifest.fee === String(held.feeSat) &&
  manifest.outputValue === String(held.outputSat) &&
  BigInt(manifest.funding.value) + BigInt(manifest.helper.value) - BigInt(manifest.outputValue) ===
    BigInt(manifest.fee);

// The pinned pipeline's T for the vault, checked against Bramble's own rebuild.
const preparedFor = async (
  context: QsbDepositContext,
  record: QsbWithdrawableRecord,
  server: QsbPublicVault,
  manifest: QsbWithdrawalManifest,
  solution: QsbSolution,
): Promise<QsbPreparedWithdrawal> => {
  const built = await rebuildQsbVault(
    context.deps,
    context.access,
    record,
    "runtimeUnavailable",
  ).catch(refuse);
  if (
    built.script.scriptHash !== record.scriptHash ||
    built.script.scriptHex !== record.scriptPubKey ||
    server.scriptHex !== built.script.scriptHex ||
    server.publicStateJson !== built.script.publicStateJson
  ) {
    refuse();
  }
  const prepared = await context.deps.runtime
    .prepare(
      built.script.publicStateJson,
      qsbManifestJson(manifest) ?? "",
      qsbSolutionJson(solution),
    )
    .catch(refuse);
  if (
    prepared.transaction !== qsbWithdrawalTransaction(manifest, solution) ||
    !isQsbSolutionInRange(solution) ||
    !isQsbDisclosureOf(prepared, solution) ||
    prepared.scriptHash !== record.scriptHash
  ) {
    refuse();
  }
  return prepared;
};

const reviewOf = (
  held: QsbWithdrawalRecord,
  manifest: QsbWithdrawalManifest,
  digest: string,
  custody: QsbCustody,
): QsbWithdrawalReview => ({
  binding: "unverified",
  custody,
  destination: manifest.destination,
  digest,
  feeSat: Number(manifest.fee),
  fundingSat: Number(manifest.funding.value),
  helperSat: Number(manifest.helper.value),
  network: "bitcoin-mainnet",
  outputSat: Number(manifest.outputValue),
  secrets: QSB_DISCLOSED_SECRETS,
  v: held.v,
  vsize: qsbWithdrawalVsize(manifest.outputScript.length / 2),
});

// The account's custody: emergency exactly when it is not the writer.
const custodyOf = async (access: QsbVaultAccess): Promise<QsbCustody> => {
  const journal = await access.journal();
  if (journal.status !== "bound") throw journalUnavailable();
  return journal.writer ? "conformant" : "emergency";
};

/**
 * Builds and checks deposit `v`'s release review. The journal record may be
 * `exposed` already (or, for a read-only account, carry its emergency
 * disclosure already), for an exact retry of a release that did not finish.
 */
export const reviewedWithdrawal = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  v: number,
): Promise<QsbReviewedWithdrawal> => {
  const context = await withdrawalContext(deps, access, QSB_FRESH_SESSION_MS);
  const custody = await custodyOf(access);
  const record = await withdrawableRecord(
    access,
    v,
    custody === "conformant" ? ["allocated", "exposed"] : ["unknown"],
  );
  const held = (await keptWithdrawals(access)).find((entry) => entry.v === v);
  if (!held || held.signed !== null || held.outcome === "refused") {
    throw withdrawalRefusal("notReady");
  }
  try {
    const job = await readyJob(context, held);
    const solved = await context.session.call((token) =>
      deps.coordinator.solvedResult(token, held.jobId),
    );
    const solution = boundSolution(held, job, solved);
    const manifest = readQsbManifest(JSON.parse(held.manifestJson)) ?? refuse();
    if (!isManifestOfIntent(manifest, held, record)) refuse();
    const listed = await context.session.call((token) => deps.coordinator.vaults(token));
    const server = listed.vaults.find((vault) => vault.id === job.vaultId) ?? refuse();
    const previous = await previousTransactions(context, manifest, record, server);
    const prepared = await preparedFor(context, record, server, manifest, solution);
    const { digest } = await access.revealDigest(
      prepared.transaction,
      prepared.round0,
      prepared.round1,
    );
    return {
      context,
      fundingPreviousTxHex: previous.funding,
      held,
      helperPreviousTxHex: previous.helper,
      manifest,
      prepared,
      record,
      review: reviewOf(held, manifest, digest, custody),
      solution,
    };
  } catch (error) {
    if (error instanceof QsbCoordinatorFailure) {
      throw error.code === "solved_result_unavailable"
        ? withdrawalRefusal("notReady")
        : coordinatorRefusal(error);
    }
    throw error;
  }
};

/**
 * The release review of deposit `v`'s found withdrawal. Discloses nothing;
 * anything that does not check out is `bindingRefused`.
 */
export const reviewQsbWithdrawal = (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  v: number,
): Promise<QsbWithdrawalReview> =>
  failClosedWith(
    () => withdrawalRefusal("bindingRefused"),
    async () => (await reviewedWithdrawal(deps, access, v)).review,
  );
