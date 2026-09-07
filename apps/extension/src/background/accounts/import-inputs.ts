/**
 * Pure parsers for untrusted raw-private-key messages. Isolated from the
 * general message parsers because they handle secret key material at the trust
 * boundary. For in-wallet import the vault passphrase comes from the unlocked
 * session, so the message carries only the target network and the private key;
 * the first-run vault-creation variant additionally carries the new vault
 * passphrase because no session exists yet.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { type AccountContractType, isAccountContractType } from "@bramble/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  isStarkPrivateKey,
  normalizeFeltInput,
  type StarknetNetworkId,
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

const readRawKeyAccountFields = (message: Record<string, unknown>): RawKeyAccountFields | null => {
  if (
    !isAccountContractType(message["accountContractType"]) ||
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
export const readImportAccountInput = (message: unknown): RawKeyAccountFields | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, [
    "accountContractType",
    "deploymentSalt",
    "networkId",
    "privateKey",
    "type",
  ]) &&
  message["type"] === "wallet.importAccount"
    ? readRawKeyAccountFields(message)
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
): (RawKeyAccountFields & { readonly vaultPassphrase: string }) | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountContractType",
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
  const fields = readRawKeyAccountFields(message);
  return fields ? { ...fields, vaultPassphrase: message["vaultPassphrase"] } : null;
};
