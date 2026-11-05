/**
 * The two-phase withdrawal assembly of the pinned QSB bridge (`bridge.prepare`
 * and `bridge.finish`): what the runtime sends each and what it accepts back.
 *
 * Trust boundary: the requests are background-built JSON text (a public state,
 * a canonical manifest, a coordinator solution already checked by the caller,
 * and for `finish` the 15 preimages Krusty released), checked here for shape
 * before any interpreter runs. The bridge's replies are interpreter output and
 * trusted for nothing: `prepare` is accepted only as exactly its seven fields
 * in their grammars, echoing the very public state, manifest and solution it
 * was given; `finish` only as one lowercase-hex transaction. Whether `T` is
 * the transaction the user should authorize is the caller's to check, against
 * its own rebuild, before anything is disclosed. Every refusal is a fixed
 * message that quotes neither the request nor the reply, so a preimage can
 * never reach an error.
 */
import { isLowercaseHexBytes } from "@bramble/core/hex";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  isQsbHash32,
  QSB_DISCLOSURE_COUNTS,
  QSB_MAX_TRANSACTION_BYTES,
  QSB_SECRETS_PER_ROUND,
} from "@bramble/vault/qsb-vault-record";
import { QSB_DISCLOSED_SECRETS } from "@bramble/wallet-model/qsb-withdrawals";
import { QSB_MAX_JSON_TEXT } from "./qsb-vault-setup";

// The fields `bridge.prepare` returns, which `finish` reads back.
const PREPARED_FIELDS = [
  "manifest",
  "publicStateJson",
  "round0",
  "round1",
  "scriptHash",
  "solution",
  "transaction",
] as const;
const PREIMAGE_BYTES = 20;
// The longest signed withdrawal `finish` may return: the coordinator's submit
// body takes at most 150,000 hex digits.
const MAX_RAW_TRANSACTION_BYTES = 75_000;

/**
 * What `prepare` returned, checked: `T` as lowercase hex, the 8 round-0 and 7
 * round-1 indices the solution discloses in the pipeline's order (never to be
 * reordered), the vault script's SHA-256, and `json`, the exact text `finish`
 * must be handed back.
 */
export type QsbPreparedWithdrawal = {
  readonly json: string;
  readonly round0: readonly number[];
  readonly round1: readonly number[];
  readonly scriptHash: string;
  readonly transaction: string;
};

/** A `prepare` request this module accepted: the JSON text the bridge reads. */
export type QsbPrepareRequest = {
  readonly json: string;
  readonly manifest: unknown;
  readonly publicStateJson: string;
  readonly solution: unknown;
};

const parsedJson = (text: unknown): unknown => {
  if (typeof text !== "string" || text.length > QSB_MAX_JSON_TEXT) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isRound = (value: unknown, count: number): value is readonly number[] =>
  Array.isArray(value) &&
  value.length === count &&
  value.every(
    (index) =>
      typeof index === "number" &&
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < QSB_SECRETS_PER_ROUND,
  ) &&
  new Set(value).size === count;

/**
 * Accepts a public state, a manifest and a solution as JSON text of at most a
 * million characters each, the manifest and solution JSON objects, and
 * returns the bridge's argument text. Throws a fixed message otherwise;
 * nothing runs.
 */
export const readQsbPrepareRequest = (
  publicStateJson: string,
  manifestJson: string,
  solutionJson: string,
): QsbPrepareRequest => {
  const manifest = parsedJson(manifestJson);
  const solution = parsedJson(solutionJson);
  if (!isRecord(parsedJson(publicStateJson)) || !isRecord(manifest) || !isRecord(solution)) {
    throw new Error("QSB withdrawal request is not a public state, manifest and solution");
  }
  return {
    json: JSON.stringify([publicStateJson, manifestJson, solutionJson]),
    manifest,
    publicStateJson,
    solution,
  };
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const isPreparedShape = (
  value: unknown,
): value is Record<(typeof PREPARED_FIELDS)[number], unknown> =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, PREPARED_FIELDS) &&
  PREPARED_FIELDS.every((field) => Object.hasOwn(value, field)) &&
  isLowercaseHexBytes(value["transaction"], 1, QSB_MAX_TRANSACTION_BYTES) &&
  isRound(value["round0"], QSB_DISCLOSURE_COUNTS.round0) &&
  isRound(value["round1"], QSB_DISCLOSURE_COUNTS.round1) &&
  isQsbHash32(value["scriptHash"]);

/**
 * Accepts `prepare`'s reply to `request` only as JSON text of exactly its
 * seven fields, each in its grammar, whose public state, manifest and
 * solution are the very ones sent. Rejects with a fixed message otherwise.
 */
export const readQsbPrepared = (
  raw: unknown,
  request: QsbPrepareRequest,
): QsbPreparedWithdrawal => {
  const reply = parsedJson(raw);
  if (!isPreparedShape(reply)) {
    throw new Error("QSB withdrawal prepare returned an unexpected shape");
  }
  if (
    reply["publicStateJson"] !== request.publicStateJson ||
    !sameJson(reply["manifest"], request.manifest) ||
    !sameJson(reply["solution"], request.solution)
  ) {
    throw new Error("QSB withdrawal prepare answered for another withdrawal");
  }
  return {
    json: raw as string,
    round0: [...(reply["round0"] as readonly number[])],
    round1: [...(reply["round1"] as readonly number[])],
    scriptHash: reply["scriptHash"] as string,
    transaction: reply["transaction"] as string,
  };
};

/**
 * Accepts exactly 15 preimages of 20 lowercase-hex bytes, round 0's then
 * round 1's, and returns the bridge's argument text for `finish` over
 * `prepared`. Throws a fixed message that quotes no preimage otherwise.
 */
export const readQsbFinishRequest = (
  prepared: QsbPreparedWithdrawal,
  preimages: readonly string[],
): string => {
  if (
    !Array.isArray(preimages) ||
    preimages.length !== QSB_DISCLOSED_SECRETS ||
    !preimages.every((preimage) => isLowercaseHexBytes(preimage, PREIMAGE_BYTES, PREIMAGE_BYTES))
  ) {
    throw new Error("QSB withdrawal finish needs exactly 15 preimages");
  }
  return JSON.stringify([prepared.json, JSON.stringify(preimages)]);
};

/**
 * Accepts `finish`'s reply only as one transaction of lowercase hex, at most
 * the coordinator's submit limit. Rejects with a fixed message otherwise.
 */
export const readQsbFinished = (raw: unknown): string => {
  if (!isLowercaseHexBytes(raw, 1, MAX_RAW_TRANSACTION_BYTES)) {
    throw new Error("QSB withdrawal finish returned an unexpected shape");
  }
  return raw;
};
