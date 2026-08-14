/**
 * Pure parser for untrusted raw-private-key import messages. Isolated from the
 * general message parsers because it handles secret key material at the trust
 * boundary; the vault passphrase is taken from the unlocked session, so the
 * message carries only the target network and the private key.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { type AccountContractType, isAccountContractType } from "@mc-wallet/wallet-model/accounts";
import {
  isStarkFieldElement,
  isStarknetNetworkId,
  isStarkPrivateKey,
  normalizeFeltInput,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";

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
export const readImportAccountInput = (
  message: unknown,
): {
  readonly accountContractType: AccountContractType;
  readonly networkId: StarknetNetworkId;
  readonly privateKey: string;
  readonly deploymentSalt?: string;
} | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "accountContractType",
      "deploymentSalt",
      "networkId",
      "privateKey",
      "type",
    ]) ||
    message["type"] !== "wallet.importAccount" ||
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
