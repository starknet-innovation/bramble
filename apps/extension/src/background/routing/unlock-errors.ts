/**
 * Classifies vault-read failures raised while unlocking the wallet.
 */

import { WalletError } from "@mc-wallet/core/errors";

const ENVELOPE_ERROR_MESSAGE = "Invalid encrypted store envelope";

// An AES-GCM authentication failure surfaces as a DOMException named
// "OperationError": it is thrown when the derived key cannot decrypt the
// stored ciphertext, i.e. the supplied passphrase is wrong.
const isDecryptionFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === "OperationError";

/**
 * Maps a vault-read failure during unlock to a caller-facing error: a
 * decryption/authentication failure (a wrong passphrase) becomes a clear
 * "Incorrect passphrase", while a corrupt or missing store envelope keeps its
 * distinct "Invalid encrypted store envelope" message. Any other error is
 * returned unchanged.
 */
export const unlockFailureError = (error: unknown): Error => {
  if (error instanceof WalletError && error.message === ENVELOPE_ERROR_MESSAGE) {
    return error;
  }
  if (isDecryptionFailure(error)) {
    return new WalletError("Incorrect passphrase");
  }
  return error instanceof Error ? error : new WalletError("wallet request failed");
};
