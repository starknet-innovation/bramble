/**
 * Pure parsers for untrusted raw-private-key messages. Isolated from the
 * general message parsers because they handle secret key material at the trust
 * boundary. For in-wallet import the vault passphrase comes from the unlocked
 * session, so the message carries only the target network and the private key;
 * the first-run vault-creation variant additionally carries the new vault
 * passphrase because no session exists yet.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import {
  type AccountContractType,
  isCreatableAccountContractType,
} from "@bramble/wallet-model/accounts";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  isStarkPrivateKey,
  normalizeFeltInput,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { isVaultPassphrase } from "@bramble/wallet-model/passphrase";

/**
 * Parsed raw-key import request: a valid target network plus a private key
 * normalized to canonical, in-range, non-zero felt form. Returns `null` for any
 * malformed message or invalid key so the caller adds no account.
 *
 * The key is normalized with `normalizeFeltInput` — the same 0x-hex-only
 * normalizer every pasted-felt path uses (recipient/token/contract/multisig
 * addresses) — rather than the base-agnostic `canonicalFelt`. That keeps key
 * input to the documented `0x…` felt form the import UI advertises and refuses
 * to reinterpret a paste under a different base: a bare decimal, octal (`0o`),
 * or binary (`0b`) string is left unchanged and then rejected downstream, so an
 * ambiguous paste can never be silently coerced into a different signing scalar
 * than the one the user believes they imported.
 */
type RawKeyAccountFields = {
  readonly accountContractType: AccountContractType;
  readonly networkId: StarknetNetworkId;
  readonly privateKey: string;
  readonly deploymentSalt?: string;
};

/**
 * A raw-key import request. A "Ready Account" (Argent) import names the
 * releases the user picked from discovery; every other family names none. The
 * background re-proves each picked release before writing.
 */
type RawKeyImportFields = RawKeyAccountFields & { readonly classHashes?: readonly string[] };

// The picked Argent releases: one to the table's size, unique, canonical felts.
// Membership in the table is checked by the background re-proof, not here.
const readClassHashes = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > deploymentClasses("argent").length) return null;
  const classHashes: string[] = [];
  for (const raw of value) {
    const classHash = typeof raw === "string" ? normalizeFeltInput(raw) : null;
    if (classHash === null || !isNonZeroStarkFieldElement(classHash)) return null;
    if (classHashes.some((seen) => sameFelt(seen, classHash))) return null;
    classHashes.push(classHash);
  }
  return classHashes;
};

// Argent imports must name their picked releases; every other family must not.
const withClassHashes = (
  fields: RawKeyAccountFields | null,
  message: Record<string, unknown>,
): RawKeyImportFields | null => {
  if (!fields) return null;
  if (fields.accountContractType !== "argent") {
    return message["classHashes"] === undefined ? fields : null;
  }
  const classHashes = readClassHashes(message["classHashes"]);
  return classHashes ? { ...fields, classHashes } : null;
};

const readRawKeyAccountFields = (message: Record<string, unknown>): RawKeyAccountFields | null => {
  if (
    !isCreatableAccountContractType(message["accountContractType"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    typeof message["privateKey"] !== "string"
  ) {
    return null;
  }

  const privateKey = normalizeFeltInput(message["privateKey"]);
  if (message["deploymentSalt"] !== undefined && typeof message["deploymentSalt"] !== "string") {
    return null;
  }
  const deploymentSalt =
    typeof message["deploymentSalt"] === "string"
      ? normalizeFeltInput(message["deploymentSalt"])
      : undefined;
  if (!isStarkPrivateKey(privateKey)) {
    return null;
  }
  if (
    (message["accountContractType"] === "openzeppelin" && deploymentSalt !== undefined) ||
    (deploymentSalt !== undefined && !isStarkFieldElement(deploymentSalt))
  ) {
    return null;
  }

  return {
    accountContractType: message["accountContractType"],
    ...(deploymentSalt === undefined ? {} : { deploymentSalt }),
    networkId: message["networkId"],
    privateKey,
  };
};

/**
 * Parses the in-wallet raw-key import request (`wallet.importAccount`): the
 * shared key/salt/network grammar above, with the vault passphrase taken from
 * the unlocked session rather than the message. Returns `null` for any
 * malformed message or invalid key so the caller adds no account.
 */
export const readImportAccountInput = (message: unknown): RawKeyImportFields | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, [
    "accountContractType",
    "classHashes",
    "deploymentSalt",
    "networkId",
    "privateKey",
    "type",
  ]) &&
  message["type"] === "wallet.importAccount"
    ? withClassHashes(readRawKeyAccountFields(message), message)
    : null;

/**
 * Parses the first-run raw-key vault-creation request. It reuses the exact
 * key/salt/network grammar of {@link readImportAccountInput} and additionally
 * requires the new vault passphrase, because no unlocked session exists before
 * onboarding completes. Returns `null` on any malformed message without
 * echoing secret material.
 */
export const readCreateKeyVaultInput = (
  message: unknown,
): (RawKeyImportFields & { readonly vaultPassphrase: string }) | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountContractType",
      "classHashes",
      "deploymentSalt",
      "networkId",
      "privateKey",
      "type",
      "vaultPassphrase",
    ]) ||
    message["type"] !== "wallet.createKeyVault" ||
    !isVaultPassphrase(message["vaultPassphrase"])
  ) {
    return null;
  }
  const fields = withClassHashes(readRawKeyAccountFields(message), message);
  return fields ? { ...fields, vaultPassphrase: message["vaultPassphrase"] } : null;
};

/**
 * Parses the Ready-key discovery request (`wallet.discoverReadyKeyAccounts`):
 * the shared key/salt/network grammar for an Argent key, used by both the
 * first-run and the in-wallet import before the user picks. Returns `null` for
 * any malformed message without echoing secret material.
 */
export const readDiscoverReadyKeyAccountsInput = (
  message: unknown,
): Omit<RawKeyAccountFields, "accountContractType"> | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["deploymentSalt", "networkId", "privateKey", "type"]) ||
    message["type"] !== "wallet.discoverReadyKeyAccounts"
  ) {
    return null;
  }
  const fields = readRawKeyAccountFields({ ...message, accountContractType: "argent" });
  if (!fields) return null;
  const { accountContractType: _argent, ...rest } = fields;
  return rest;
};
