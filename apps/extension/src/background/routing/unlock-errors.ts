/**
 * Classifies vault-read failures raised while unlocking the wallet.
 */

import { WalletError } from "@bramble/core/errors";

const ENVELOPE_ERROR_MESSAGE = "Invalid encrypted store envelope";

/**
 * The caller-facing message for a wrong passphrase. Exported so the mobile
 * apps show the same words (generated into their copy tables); it never
 * includes anything the user typed.
 */
export const INCORRECT_PASSPHRASE_MESSAGE = "Incorrect passphrase";

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
    return new WalletError(INCORRECT_PASSPHRASE_MESSAGE);
  }
  return error instanceof Error ? error : new WalletError("wallet request failed");
};
