/**
 * The scalar grammars the coordinator's answers are written in, as qsb-app's
 * `src/lib/model.ts` defines them: hex (either case), 32-byte ids, satoshi
 * amounts as decimal text, outpoints and uuids. Shared by every response
 * parser here so no two read the same field differently.
 *
 * Total and fail-closed: each reader returns the value in Bramble's own
 * spelling (lowercase hex, a safe-integer amount) or null, never a coerced
 * or partial one.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { QSB_MAX_SAT } from "@bramble/wallet-model/qsb-vaults";

/** One output: its txid in display order, its index and its value in satoshis. */
export type QsbOutpoint = {
  readonly txid: string;
  readonly valueSat: number;
  readonly vout: number;
};

const ANY_CASE_HEX = /^(?:[0-9a-fA-F]{2})*$/;
const SATS = /^(?:0|[1-9][0-9]{0,15})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks for a uuid in either case, as the coordinator's ids are. */
export const isQsbUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

/** Hex of `minBytes` to `maxBytes` bytes in either case, returned lowercase. */
export const readHex = (value: unknown, minBytes: number, maxBytes: number): string | null =>
  typeof value === "string" &&
  value.length >= minBytes * 2 &&
  value.length <= maxBytes * 2 &&
  ANY_CASE_HEX.test(value)
    ? value.toLowerCase()
    : null;

/** A 32-byte id (txid, script hash, block hash), returned lowercase. */
export const readTxid = (value: unknown): string | null => readHex(value, 32, 32);

/** A satoshi amount as decimal text, at most 21 million BTC, as a number. */
export const readSats = (value: unknown): number | null => {
  if (typeof value !== "string" || !SATS.test(value)) return null;
  const sats = Number(value);
  return sats <= QSB_MAX_SAT ? sats : null;
};

/** A record with only `keys`, every one of them present. */
export const hasExactKeys = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, keys) &&
  keys.every((key) => Object.hasOwn(value, key));

/**
 * An outpoint `{ txid, vout, value }` with exactly those keys, `value` as
 * decimal satoshi text.
 */
export const readOutpoint = (value: unknown): QsbOutpoint | null => {
  if (
    !hasExactKeys(value, ["txid", "value", "vout"]) ||
    !Number.isSafeInteger(value["vout"]) ||
    (value["vout"] as number) < 0 ||
    (value["vout"] as number) > 0xffff_ffff
  ) {
    return null;
  }
  const txid = readTxid(value["txid"]);
  const valueSat = readSats(value["value"]);
  return txid !== null && valueSat !== null
    ? { txid, valueSat, vout: value["vout"] as number }
    : null;
};

/**
 * A plain array of at most `max` entries, each read by `read`; null when it
 * is not one or any entry fails.
 */
export const readList = <T>(
  value: unknown,
  max: number,
  read: (entry: unknown) => T | null,
): readonly T[] | null => {
  if (!Array.isArray(value) || value.length > max) return null;
  const entries: T[] = [];
  for (const entry of value) {
    const parsed = read(entry);
    if (parsed === null) return null;
    entries.push(parsed);
  }
  return entries;
};
