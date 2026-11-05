/**
 * The withdrawal manifest a QSB job is created with, ported from qsb-app
 * `src/lib/model.ts` (`withdrawalSchema`, `canonicalManifest`) and
 * `server/app.ts` (`manifestHash = sha256(JSON.stringify(manifest))`).
 *
 * The hash is over the schema-ordered JSON with no whitespace: `vaultId`,
 * `funding`, `helper` (each outpoint `txid`, `vout`, `value`, txids
 * lowercase), `destination`, `outputScript`, `outputValue`, `fee`,
 * `idempotencyKey`, `costAccepted`, then `solverReleaseId` when set. A
 * manifest read back from the coordinator may come with its keys reordered,
 * so it is parsed strictly and re-emitted in that order before it is hashed
 * or compared; anything outside the schema is refused rather than dropped.
 * Pure: SHA-256 is @noble/hashes'.
 */
import { bytesToHex } from "@bramble/core/hex";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { sha256 } from "@noble/hashes/sha2.js";
import { hasExactKeys, isQsbUuid, readHex, readTxid } from "../coordinator/response-grammar";

/** One outpoint of a manifest, as the coordinator spells it: value as decimal text. */
export type QsbManifestOutpoint = {
  readonly txid: string;
  readonly vout: number;
  readonly value: string;
};

/** A withdrawal manifest, keys in the schema's order. */
export type QsbWithdrawalManifest = {
  readonly vaultId: string;
  readonly funding: QsbManifestOutpoint;
  readonly helper: QsbManifestOutpoint;
  readonly destination: string;
  readonly outputScript: string;
  readonly outputValue: string;
  readonly fee: string;
  readonly idempotencyKey: string;
  readonly costAccepted: true;
  readonly solverReleaseId?: string;
};

const SATS = /^(?:0|[1-9][0-9]*)$/;
const MAX_SATS = 2_100_000_000_000_000n;
const SOLVER_RELEASE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MANIFEST_KEYS = [
  "costAccepted",
  "destination",
  "fee",
  "funding",
  "helper",
  "idempotencyKey",
  "outputScript",
  "outputValue",
  "solverReleaseId",
  "vaultId",
] as const;
// `outputScript` is at most 200 hex digits.
const MAX_OUTPUT_SCRIPT_BYTES = 100;

const readAmount = (value: unknown): string | null =>
  typeof value === "string" && SATS.test(value) && BigInt(value) <= MAX_SATS ? value : null;

const readManifestOutpoint = (value: unknown): QsbManifestOutpoint | null => {
  if (
    !hasExactKeys(value, ["txid", "value", "vout"]) ||
    !Number.isSafeInteger(value["vout"]) ||
    (value["vout"] as number) < 0 ||
    (value["vout"] as number) > 0xffff_ffff
  ) {
    return null;
  }
  const txid = readTxid(value["txid"]);
  const amount = readAmount(value["value"]);
  return txid !== null && amount !== null
    ? { txid, vout: value["vout"] as number, value: amount }
    : null;
};

const isDestinationText = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 14 && value.length <= 100;

/**
 * Parses a manifest strictly into its canonical form (txids lowercased, keys
 * in schema order), or null for anything outside the schema: a missing or
 * extra field, a uuid, amount, script or release id out of its grammar.
 */
export const readQsbManifest = (value: unknown): QsbWithdrawalManifest | null => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, MANIFEST_KEYS)) return null;
  const funding = readManifestOutpoint(value["funding"]);
  const helper = readManifestOutpoint(value["helper"]);
  const outputScript = readHex(value["outputScript"], 1, MAX_OUTPUT_SCRIPT_BYTES);
  const outputValue = readAmount(value["outputValue"]);
  const fee = readAmount(value["fee"]);
  const release = value["solverReleaseId"];
  if (
    !isQsbUuid(value["vaultId"]) ||
    !isQsbUuid(value["idempotencyKey"]) ||
    !isDestinationText(value["destination"]) ||
    value["costAccepted"] !== true ||
    (release !== undefined && (typeof release !== "string" || !SOLVER_RELEASE.test(release))) ||
    !funding ||
    !helper ||
    outputScript === null ||
    outputValue === null ||
    fee === null
  ) {
    return null;
  }
  return {
    vaultId: value["vaultId"],
    funding,
    helper,
    destination: value["destination"],
    outputScript,
    outputValue,
    fee,
    idempotencyKey: value["idempotencyKey"],
    costAccepted: true,
    ...(release === undefined ? {} : { solverReleaseId: release as string }),
  };
};

/**
 * The canonical JSON text of a manifest, the bytes its hash is taken over, or
 * null when it is not one.
 */
export const qsbManifestJson = (manifest: unknown): string | null => {
  const canonical = readQsbManifest(manifest);
  return canonical === null ? null : JSON.stringify(canonical);
};

/** `manifestHash`: SHA-256 of the canonical JSON text, lowercase hex. */
export const qsbManifestHash = (manifestJson: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(manifestJson)));
