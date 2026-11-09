/**
 * Account derivation provenance: the kinds a stored account may carry, their
 * exact-shape validators, and the one ladder position a recovery candidate
 * occupies. Pure data validation — no key material enters this module.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  isLedgerAccountIndex,
  isLedgerAccountPathFor,
  isLedgerEip2645Application,
  type LedgerEip2645Application,
} from "./ledger-path";

/** BIP-44 provenance; `seedId` names the imported phrase, absent = founding. */
export type Bip44Derivation = {
  readonly accountIndex: number;
  readonly addressIndex: number;
  readonly kind: "starknet-bip44";
  readonly seedId?: string;
};

/** Imported-phrase handle grammar: sequential vault-allocated, bounded. */
export const isImportedSeedId = (value: unknown): value is string =>
  typeof value === "string" && /^phrase-[1-9][0-9]{0,3}$/.test(value);

/**
 * Provenance for an account imported from a raw Starknet signing key.
 */
export type ImportedKeyDerivation = {
  readonly kind: "imported-raw-key";
};

/**
 * Ready (Argent X) provenance: the vendor derives an Ethereum key at
 * m/44'/60'/0'/0/0 from the phrase and roots the stark tree in it, deriving
 * m/44'/9004'/0'/0/{addressIndex} (issue 505). Krusty exposes it as an x-only
 * keypair, so refs carrying this kind omit `publicKeyY`, like imported
 * accounts do.
 */
export type ArgentXBip44Derivation = {
  readonly addressIndex: number;
  readonly kind: "argentx-bip44";
  readonly seedId?: string;
};

/**
 * Public coordinates needed to ask a Ledger to sign for an account again; the
 * marker names the path scheme (`LedgerW` created here, `argentx` from Ready).
 */
export type LedgerDerivation = {
  readonly accountIndex: number;
  readonly eip2645application: LedgerEip2645Application;
  readonly kind: "ledger";
  readonly path: string;
};

/**
 * Account provenance discriminated by the signer kind.
 */
export type AccountDerivation =
  | ArgentXBip44Derivation
  | Bip44Derivation
  | ImportedKeyDerivation
  | LedgerDerivation;

const isSafeIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

/** Exact-shape validator for this wallet's own BIP-44 provenance; unknown keys fail closed. */
export const isBip44Derivation = (value: unknown): value is Bip44Derivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "addressIndex", "kind", "seedId"]) &&
  value["kind"] === "starknet-bip44" &&
  isSafeIndex(value["accountIndex"]) &&
  isSafeIndex(value["addressIndex"]) &&
  (value["seedId"] === undefined || isImportedSeedId(value["seedId"]));

/** Exact-shape validator for raw-key import provenance; unknown keys fail closed. */
export const isImportedKeyDerivation = (value: unknown): value is ImportedKeyDerivation =>
  isRecord(value) && hasOnlyKnownKeys(value, ["kind"]) && value["kind"] === "imported-raw-key";

/** Exact-shape validator for Ready-scheme provenance (issue 505); unknown keys fail closed. */
export const isArgentXBip44Derivation = (value: unknown): value is ArgentXBip44Derivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["addressIndex", "kind", "seedId"]) &&
  value["kind"] === "argentx-bip44" &&
  isSafeIndex(value["addressIndex"]) &&
  (value["seedId"] === undefined || isImportedSeedId(value["seedId"]));

/** Exact-shape validator for Ledger provenance against the admitted path schemes. */
export const isLedgerDerivation = (
  value: unknown,
  applications: readonly LedgerEip2645Application[],
): value is LedgerDerivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "eip2645application", "kind", "path"]) &&
  value["kind"] === "ledger" &&
  isLedgerAccountIndex(value["accountIndex"]) &&
  isLedgerEip2645Application(value["eip2645application"]) &&
  applications.includes(value["eip2645application"]) &&
  isLedgerAccountPathFor(value["path"], value["eip2645application"], value["accountIndex"]);

/**
 * The one ladder position a recovery candidate occupies. Every scan shape
 * walks exactly one axis and leaves the other at zero — this wallet's own
 * ladder steps the hardened account field, the vendors' schemes step the
 * address field — so the sum names the stepped index for either kind.
 */
export const recoveryLadderIndex = (account: {
  readonly derivation: ArgentXBip44Derivation | Bip44Derivation;
}): number =>
  account.derivation.kind === "argentx-bip44"
    ? account.derivation.addressIndex
    : account.derivation.accountIndex + account.derivation.addressIndex;
