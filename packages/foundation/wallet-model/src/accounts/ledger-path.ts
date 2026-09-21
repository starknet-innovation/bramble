/**
 * EIP-2645 Starknet derivation paths for Ledger hardware accounts.
 *
 * The path string is the sole coordinate the device uses to pick which key it
 * signs with, so onboarding (public-key enumeration) and signing must hand the
 * device byte-for-byte the same path or it signs with a different key than the
 * one enumerated. Two path schemes exist, keyed by their EIP-2645 application
 * segment, and a stored path can only ever round-trip through the builder for
 * its own scheme:
 *
 * - `LedgerW` — Bramble's own accounts: `m/2645'/1195502025'/734980059'/0'/<index>'/0`,
 *   byte-identical to starknet.js `getLedgerPathBuffer221(index, "LedgerW")`,
 *   so a stored path stays valid if v1 blind-signing is later upgraded to a
 *   starknet.js `LedgerSigner`.
 * - `argentx` — accounts created in Ready (formerly Argent X):
 *   `m/2645'/1195502025'/1148870696'/0'/0'/<index>`, Ready's
 *   `STANDARD_LEDGER_DERIVATION_PATH` (`1148870696` is the low 31 bits of
 *   sha256("argentx")). The device derives a different key per application, so
 *   a Ready Ledger account is only found by enumerating at this path.
 *
 * Both schemes are six components deep and start with `2645'`, the shape the
 * Ledger Starknet app requires. Pure and deterministic — no device or clock.
 */

/**
 * EIP-2645 application segments this wallet can address a Ledger with. Closed
 * set: the account model rejects any other marker so a stored path can never
 * silently select a key neither scheme enumerated.
 */
export type LedgerEip2645Application = "LedgerW" | "argentx";

/**
 * EIP-2645 application segment Bramble pins for accounts it creates itself. The
 * device derives a distinct key per application; pinning one keeps a stored path
 * reproducible without recomputing an application hash at sign time.
 */
export const LEDGER_EIP2645_APPLICATION = "LedgerW" as const;

/**
 * EIP-2645 application segment Ready (Argent X) uses for its Ledger accounts.
 * Enumerating at this scheme is how an existing Ready Ledger account is restored.
 */
export const READY_EIP2645_APPLICATION = "argentx" as const;

/**
 * Validates the closed set of supported EIP-2645 application markers.
 */
export const isLedgerEip2645Application = (value: unknown): value is LedgerEip2645Application =>
  value === LEDGER_EIP2645_APPLICATION || value === READY_EIP2645_APPLICATION;

/**
 * Maximum public accounts accepted in one Ledger enumeration response.
 */
export const MAX_LEDGER_ACCOUNT_BATCH = 5;

// Each scheme is a fixed prefix and suffix around the decimal account index.
// The apostrophe marks a hardened level to the device path parser. Prefixes
// differ at the application segment, so a path matches at most one scheme.
// LedgerW is verified byte-identical to starknet.js getLedgerPathBuffer221;
// argentx to Ready's STANDARD_LEDGER_DERIVATION_PATH + "/<index>".
const PATH_SCHEMES: Readonly<
  Record<LedgerEip2645Application, { readonly prefix: string; readonly suffix: string }>
> = {
  LedgerW: { prefix: "m/2645'/1195502025'/734980059'/0'/", suffix: "'/0" },
  argentx: { prefix: "m/2645'/1195502025'/1148870696'/0'/0'/", suffix: "" },
};

const APPLICATIONS: readonly LedgerEip2645Application[] = [
  LEDGER_EIP2645_APPLICATION,
  READY_EIP2645_APPLICATION,
];

// A BIP-32/EIP-2645 child index must stay below 2^31 or the device path parser
// rejects it (hardened children add that bit); both schemes' account index
// shares the ceiling whether it lands on a hardened or a plain level.
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
 * Builds the canonical EIP-2645 Starknet path for a Ledger account index under
 * one application scheme (Bramble's `LedgerW` unless told otherwise). Throws on
 * an out-of-range index rather than emitting a path the device would reject, so
 * callers get a typed failure at the boundary.
 */
export const ledgerAccountPath = (
  accountIndex: number,
  application: LedgerEip2645Application = LEDGER_EIP2645_APPLICATION,
): string => {
  if (!isLedgerAccountIndex(accountIndex)) {
    throw new RangeError("Ledger account index out of range");
  }
  const scheme = PATH_SCHEMES[application];
  return `${scheme.prefix}${accountIndex}${scheme.suffix}`;
};

/**
 * The scheme and index a canonical Ledger path was built from.
 */
export type ParsedLedgerAccountPath = {
  readonly accountIndex: number;
  readonly application: LedgerEip2645Application;
};

/**
 * Parses a canonical Ledger path back into its application scheme and account
 * index, or returns null if the string is not a path {@link ledgerAccountPath}
 * could have produced under either scheme. Used to validate a stored path and
 * to recover its coordinates for display without a second field.
 */
export const parseLedgerAccountPath = (path: unknown): ParsedLedgerAccountPath | null => {
  if (typeof path !== "string") {
    return null;
  }
  for (const application of APPLICATIONS) {
    const scheme = PATH_SCHEMES[application];
    if (!path.startsWith(scheme.prefix) || !path.endsWith(scheme.suffix)) {
      continue;
    }
    const middle = path.slice(scheme.prefix.length, path.length - scheme.suffix.length);
    if (!/^\d+$/.test(middle)) {
      return null;
    }
    const accountIndex = Number(middle);
    return isLedgerAccountIndex(accountIndex) && `${accountIndex}` === middle
      ? { accountIndex, application }
      : null;
  }
  return null;
};

/**
 * Parses the account index out of a canonical Ledger path under either scheme,
 * or returns null if the string is not a path this module could have produced.
 */
export const ledgerAccountIndexOfPath = (path: unknown): number | null =>
  parseLedgerAccountPath(path)?.accountIndex ?? null;

/**
 * True when a stored path is exactly the one this module builds for the given
 * scheme and index. The account model runs this so a `LedgerW` marker can never
 * sit over an `argentx` path (or vice versa): that record would sign with a key
 * the picker never enumerated, so it fails closed.
 */
export const isLedgerAccountPathFor = (
  path: unknown,
  application: LedgerEip2645Application,
  accountIndex: number,
): boolean => {
  const parsed = parseLedgerAccountPath(path);
  return (
    parsed !== null && parsed.application === application && parsed.accountIndex === accountIndex
  );
};

/**
 * True when a string is a canonical Ledger account path this module produced.
 * The schema validator and the device broker use this so a path can only ever
 * round-trip through {@link ledgerAccountPath}, closing the door on a
 * hand-crafted path that would silently derive a different key.
 */
export const isLedgerAccountPath = (value: unknown): value is string =>
  parseLedgerAccountPath(value) !== null;
