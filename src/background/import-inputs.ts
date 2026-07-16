/**
 * Pure parser for untrusted raw-private-key import messages. Isolated from the
 * general message parsers because it handles secret key material at the trust
 * boundary; the vault passphrase is taken from the unlocked session, so the
 * message carries only the target network and the private key.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import {
  canonicalFelt,
  isStarknetNetworkId,
  isStarkPrivateKey,
  type StarknetNetworkId,
} from "../starknet/networks";

/**
 * Parsed raw-key import request: a valid target network plus a private key
 * normalized to canonical, in-range, non-zero felt form. Returns `null` for any
 * malformed message or invalid key so the caller adds no account.
 */
export const readImportAccountInput = (
  message: unknown,
): { readonly networkId: StarknetNetworkId; readonly privateKey: string } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["networkId", "privateKey", "type"]) ||
    message["type"] !== "wallet.importAccount" ||
    !isStarknetNetworkId(message["networkId"]) ||
    typeof message["privateKey"] !== "string"
  ) {
    return null;
  }

  const privateKey = canonicalFelt(message["privateKey"].trim());
  if (privateKey === null || !isStarkPrivateKey(privateKey)) {
    return null;
  }

  return { networkId: message["networkId"], privateKey };
};
