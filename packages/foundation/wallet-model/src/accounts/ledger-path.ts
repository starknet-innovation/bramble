/**
 * EIP-2645 Starknet derivation paths for Ledger hardware accounts.
 *
 * The path string is the sole coordinate the device uses to pick which key it
 * signs with, so onboarding (public-key enumeration) and signing must hand the
 * device byte-for-byte the same path or it signs with a different key than the
 * one enumerated. These builders produce the canonical hardened path used by
 * the current Ledger Starknet app for the default `LedgerW` application; the
 * bytes are identical to starknet.js `getLedgerPathBuffer221(index, "LedgerW")`,
 * so a stored path stays valid if v1 blind-signing is later upgraded to a
 * starknet.js `LedgerSigner`. Pure and deterministic — no device or clock.
 */

/**
 * EIP-2645 application segment Bramble pins for Ledger accounts. The device
 * derives a distinct key per application; pinning one keeps a stored path
 * reproducible without recomputing an application hash at sign time.
 */
export const LEDGER_EIP2645_APPLICATION = "LedgerW";

/**
 * Maximum public accounts accepted in one Ledger enumeration response.
 */
export const MAX_LEDGER_ACCOUNT_BATCH = 5;

// Hardened purpose/coin-type/application/change prefix and the trailing
// non-hardened leaf, verified byte-identical to starknet.js
// getLedgerPathBuffer221(index, "LedgerW"). The account index is spliced
// between them. The apostrophe marks a hardened level to the device path parser.
const PATH_PREFIX = "m/2645'/1195502025'/734980059'/0'/";
const PATH_SUFFIX = "'/0";

// A hardened BIP-32/EIP-2645 child index must stay below 2^31 or the device
// path parser rejects it; the leaf account index shares that ceiling.
const MAX_HARDENED_INDEX = 0x80000000;

/**
 * True when an integer is a usable Ledger account index: a non-negative safe
 * integer below the hardened-child ceiling the device path parser enforces.
 */
export const isLedgerAccountIndex = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value < MAX_HARDENED_INDEX;

/**
 * Builds the canonical EIP-2645 Starknet path for a Ledger account index.
 * Throws on an out-of-range index rather than emitting a path the device would
 * reject, so callers get a typed failure at the boundary.
 */
export const ledgerAccountPath = (accountIndex: number): string => {
  if (!isLedgerAccountIndex(accountIndex)) {
    throw new RangeError("Ledger account index out of range");
  }
  return `${PATH_PREFIX}${accountIndex}${PATH_SUFFIX}`;
};

/**
 * Parses the account index out of a canonical Ledger path, or returns null if
 * the string is not a path this module could have produced. Used to validate a
 * stored path and to recover its index for display without a second field.
 */
export const ledgerAccountIndexOfPath = (path: unknown): number | null => {
  if (typeof path !== "string" || !path.startsWith(PATH_PREFIX) || !path.endsWith(PATH_SUFFIX)) {
    return null;
  }
  const middle = path.slice(PATH_PREFIX.length, path.length - PATH_SUFFIX.length);
  if (!/^\d+$/.test(middle)) {
    return null;
  }
  const index = Number(middle);
  return isLedgerAccountIndex(index) && `${index}` === middle ? index : null;
};

/**
 * True when a string is a canonical Ledger account path this module produced.
 * The schema validator uses this so a stored path can only ever round-trip
 * through {@link ledgerAccountPath}, closing the door on a hand-crafted path
 * that would silently derive a different key.
 */
export const isLedgerAccountPath = (value: unknown): value is string =>
  ledgerAccountIndexOfPath(value) !== null;
