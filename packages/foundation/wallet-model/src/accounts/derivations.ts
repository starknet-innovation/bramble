/**
 * Account provenance: how the wallet reaches the signer for an account again.
 * Public coordinates only — no derivation here carries key material or a handle
 * to any, so every value is safe to persist in account metadata and to project
 * outside the vault. Each variant ships its own exact validator, because a
 * derivation read back from storage or off an untrusted message decides which
 * signing backend a submit will use.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import {
  isLedgerAccountIndex,
  isLedgerAccountPath,
  LEDGER_EIP2645_APPLICATION,
  ledgerAccountIndexOfPath,
} from "./ledger-path";

/**
 * BIP-44 provenance for an account derived from the recovery phrase.
 */
export type Bip44Derivation = {
  readonly accountIndex: number;
  readonly addressIndex: number;
  readonly kind: "starknet-bip44";
};

/**
 * Provenance for an account imported from a raw Starknet signing key.
 */
export type ImportedKeyDerivation = {
  readonly kind: "imported-raw-key";
};

/**
 * Public coordinates needed to ask a Ledger to sign for an account again.
 */
export type LedgerDerivation = {
  readonly accountIndex: number;
  readonly eip2645application: string;
  readonly kind: "ledger";
  readonly path: string;
};

/**
 * How the extension reaches a paired post-quantum signing device again.
 * `clipboard` is the manual copy/paste channel: a base64url string out, a
 * base64url string back, with no relay, no Bluetooth, and no phone required in
 * tests. It is the only transport that runs in CI, so it stays supported even
 * once others exist.
 */
export type TransportDescriptor = {
  readonly kind: "clipboard";
};

/**
 * Public coordinates needed to ask a paired phone to sign for an account again.
 * ML-DSA keys are hardware-bound and not derived, so there is no index to walk
 * and no path to rebuild: `deviceId` names which enclave key to use, and the
 * device chooses it. Non-secret by construction — losing it leaks nothing, and
 * it cannot be used to sign.
 */
export type MobilePqDerivation = {
  readonly deviceId: string;
  readonly kind: "mobile-pq";
  readonly transport: TransportDescriptor;
};

/**
 * Account provenance discriminated by the signer kind.
 */
export type AccountDerivation =
  | Bip44Derivation
  | ImportedKeyDerivation
  | LedgerDerivation
  | MobilePqDerivation;

/**
 * Stable, non-secret device identifier chosen by the phone. Bounded so an
 * untrusted pairing response cannot grow an account record without limit.
 */
const MAX_DEVICE_ID_LENGTH = 64;

const isSafeIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

/**
 * Validates BIP-44 provenance for an account derived from the recovery phrase.
 */
export const isBip44Derivation = (value: unknown): value is Bip44Derivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "addressIndex", "kind"]) &&
  value["kind"] === "starknet-bip44" &&
  isSafeIndex(value["accountIndex"]) &&
  isSafeIndex(value["addressIndex"]);

/**
 * Validates provenance for an account imported from a raw signing key.
 */
export const isImportedKeyDerivation = (value: unknown): value is ImportedKeyDerivation =>
  isRecord(value) && hasOnlyKnownKeys(value, ["kind"]) && value["kind"] === "imported-raw-key";

/**
 * Validates Ledger provenance, including that the stored path and index agree.
 * A mismatch would silently select a different device key, so both are checked.
 */
export const isLedgerDerivation = (value: unknown): value is LedgerDerivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountIndex", "eip2645application", "kind", "path"]) &&
  value["kind"] === "ledger" &&
  isLedgerAccountIndex(value["accountIndex"]) &&
  value["eip2645application"] === LEDGER_EIP2645_APPLICATION &&
  isLedgerAccountPath(value["path"]) &&
  ledgerAccountIndexOfPath(value["path"]) === value["accountIndex"];

/**
 * True when a derivation names an external device rather than a vault-held key,
 * so the vault stores no key entry for the account. The one definition of that
 * rule: the vault validator enforces its account/key bijection with it, and
 * `isKeylessAccount` answers with it, so the two cannot disagree about which
 * kinds are allowed to carry none.
 */
export const isKeylessDerivation = (derivation: AccountDerivation): boolean =>
  derivation.kind === "ledger" || derivation.kind === "mobile-pq";

const isTransportDescriptor = (value: unknown): value is TransportDescriptor =>
  isRecord(value) && hasOnlyKnownKeys(value, ["kind"]) && value["kind"] === "clipboard";

/**
 * Validates paired-phone provenance. The device id must be a bounded non-empty
 * string and the transport one this build can actually reach, so a record that
 * would strand an account with no way to sign is rejected at the boundary.
 */
export const isMobilePqDerivation = (value: unknown): value is MobilePqDerivation =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["deviceId", "kind", "transport"]) &&
  value["kind"] === "mobile-pq" &&
  typeof value["deviceId"] === "string" &&
  value["deviceId"].length > 0 &&
  value["deviceId"].length <= MAX_DEVICE_ID_LENGTH &&
  isTransportDescriptor(value["transport"]);
