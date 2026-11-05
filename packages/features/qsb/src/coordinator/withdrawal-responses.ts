/**
 * Parsers for the QSB coordinator's withdrawal routes (qsb-app
 * `server/app.ts`, `server/submit-exact.ts`, `server/withdrawal-status.ts`,
 * `src/mainnet/coordinatorResult.ts`): jobs, the public solved result, the
 * exact-submit answer and a withdrawal transaction's status.
 *
 * Trust boundary: every answer is untrusted. A job record carries many
 * operational fields Bramble never reads (solver pins, GPU budgets, attempt
 * counters), so a job is parsed by the fields read, each strictly, and the
 * rest ignored; its manifest is parsed strictly into canonical form. The
 * solved result and the submit answer are parsed exactly, every field. A
 * transaction status is parsed by the fields read, as the route adds
 * diagnostics freely. Anything else is null, which the client turns into a
 * failure.
 */
import { isRecord } from "@bramble/core/json";
import { type QsbSolution, readQsbSolution } from "../withdrawal/binding";
import { type QsbWithdrawalManifest, readQsbManifest } from "../withdrawal/manifest";
import { hasExactKeys, isQsbUuid, readList, readTxid } from "./response-grammar";

/** A job's status (`model.ts` `Job.status`). */
export type QsbJobStatus =
  | "awaiting_authorization"
  | "confirmed"
  | "failed"
  | "paused"
  | "queued"
  | "searching"
  | "submitted";

/** A job's search stage. */
export type QsbJobStage = "pinning" | "round1" | "round2" | "verification";

/** A withdrawal job by the fields Bramble reads. */
export type QsbJob = {
  readonly id: string;
  readonly manifest: QsbWithdrawalManifest;
  readonly manifestHash: string;
  readonly stage: QsbJobStage;
  readonly status: QsbJobStatus;
  readonly txid: string | null;
  readonly vaultId: string;
};

/** The coordinator's public solved result for one job. */
export type QsbSolvedResult = {
  readonly jobId: string;
  readonly manifest: QsbWithdrawalManifest;
  readonly manifestHash: string;
  readonly solution: QsbSolution;
  readonly vaultId: string;
};

/** How a withdrawal submission or a withdrawal transaction stands. */
export type QsbWithdrawalOutcome = "conflict" | "confirmed" | "submitted" | "uncertain";

/** The exact-submit answer: the txid the coordinator recorded and its outcome. */
export type QsbWithdrawalSubmitAnswer = {
  readonly status: QsbWithdrawalOutcome;
  readonly txid: string;
};

/** A withdrawal transaction's status, by the fields Bramble reads. */
export type QsbWithdrawalTransactionStatus = {
  readonly chainUnavailable: boolean;
  readonly confirmations: number | null;
  readonly includedTxid: string | null;
  readonly status: QsbWithdrawalOutcome;
  readonly txid: string;
};

const JOB_STATUSES: readonly QsbJobStatus[] = [
  "awaiting_authorization",
  "confirmed",
  "failed",
  "paused",
  "queued",
  "searching",
  "submitted",
];
const JOB_STAGES: readonly QsbJobStage[] = ["pinning", "round1", "round2", "verification"];
const OUTCOMES: readonly QsbWithdrawalOutcome[] = [
  "conflict",
  "confirmed",
  "submitted",
  "uncertain",
];
const HASH = /^[0-9a-f]{64}$/;
// An owner has at most one job per vault, ever, and at most 64 vaults per
// QSB account; the list bound is Bramble's, with room over.
const MAX_JOBS = 256;
const SOLVED_RESULT_FORMAT = "qsb-coordinator-public-solved-result-v1";

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === "string" && (options as readonly string[]).includes(value);

const isHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);

/** Parses one job record by the fields Bramble reads; null if any is malformed. */
export const readQsbJob = (value: unknown): QsbJob | null => {
  if (!isRecord(value)) return null;
  const manifest = readQsbManifest(value["manifest"]);
  const txid = value["txid"] === undefined ? null : readTxid(value["txid"]);
  if (
    !isQsbUuid(value["id"]) ||
    !isQsbUuid(value["vaultId"]) ||
    !isOneOf(value["status"], JOB_STATUSES) ||
    !isOneOf(value["stage"], JOB_STAGES) ||
    !isHash(value["manifestHash"]) ||
    manifest === null ||
    (value["txid"] !== undefined && txid === null)
  ) {
    return null;
  }
  return {
    id: value["id"].toLowerCase(),
    manifest,
    manifestHash: value["manifestHash"],
    stage: value["stage"],
    status: value["status"],
    txid,
    vaultId: value["vaultId"].toLowerCase(),
  };
};

/** Parses `GET /v1/jobs`: `{ jobs }`, every job well formed. */
export const readQsbJobs = (value: unknown): readonly QsbJob[] | null =>
  hasExactKeys(value, ["jobs"]) ? readList(value["jobs"], MAX_JOBS, readQsbJob) : null;

/** Parses `POST /v1/jobs`: `{ job }`. */
export const readQsbCreatedJob = (value: unknown): QsbJob | null =>
  hasExactKeys(value, ["job"]) ? readQsbJob(value["job"]) : null;

/** Parses `GET /v1/jobs/:id/solved-result` exactly, every field. */
export const readQsbSolvedResult = (value: unknown): QsbSolvedResult | null => {
  if (
    !hasExactKeys(value, [
      "format",
      "jobId",
      "manifest",
      "manifestHash",
      "network",
      "solution",
      "vaultId",
    ]) ||
    value["format"] !== SOLVED_RESULT_FORMAT ||
    value["network"] !== "mainnet" ||
    !isQsbUuid(value["jobId"]) ||
    !isQsbUuid(value["vaultId"]) ||
    !isHash(value["manifestHash"])
  ) {
    return null;
  }
  const manifest = readQsbManifest(value["manifest"]);
  const solution = readQsbSolution(value["solution"]);
  return manifest && solution
    ? {
        jobId: value["jobId"].toLowerCase(),
        manifest,
        manifestHash: value["manifestHash"],
        solution,
        vaultId: value["vaultId"].toLowerCase(),
      }
    : null;
};

/** Parses `POST /v1/jobs/:id/submit`: exactly `{ txid, status }`. */
export const readQsbWithdrawalSubmitAnswer = (value: unknown): QsbWithdrawalSubmitAnswer | null => {
  if (!hasExactKeys(value, ["status", "txid"]) || !isOneOf(value["status"], OUTCOMES)) return null;
  const txid = readTxid(value["txid"]);
  return txid === null ? null : { status: value["status"], txid };
};

const readConfirmations = (chain: unknown): number | null | undefined => {
  if (chain === null || chain === undefined) return null;
  if (!isRecord(chain)) return undefined;
  const confirmations = chain["confirmations"];
  return typeof confirmations === "number" &&
    Number.isSafeInteger(confirmations) &&
    confirmations >= 0
    ? confirmations
    : undefined;
};

/** Parses `GET /v1/transactions/:txid/status` by the fields Bramble reads. */
export const readQsbWithdrawalTransactionStatus = (
  value: unknown,
): QsbWithdrawalTransactionStatus | null => {
  if (!isRecord(value) || !isOneOf(value["status"], OUTCOMES)) return null;
  const txid = readTxid(value["txid"]);
  const included = value["includedTxid"];
  const includedTxid = included === undefined ? null : readTxid(included);
  const unavailable = value["chainUnavailable"];
  const confirmations = readConfirmations(value["chain"]);
  if (
    txid === null ||
    (included !== undefined && includedTxid === null) ||
    (unavailable !== undefined && typeof unavailable !== "boolean") ||
    confirmations === undefined
  ) {
    return null;
  }
  return {
    chainUnavailable: unavailable === true,
    confirmations,
    includedTxid,
    status: value["status"],
    txid,
  };
};
