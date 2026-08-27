/**
 * Parsers for the privileged paired-phone background messages. Each validates
 * the untrusted extension-page payload once, at this boundary, into a precise
 * type the handlers can trust. No secret material crosses here: a phone message
 * carries only a queue id, a rejection code, and a public ML-DSA-65 signature.
 *
 * The lengths are the whole point of this file. A post-quantum signature is
 * 3309 bytes where a Stark one is two felts, and a validator that accepted a
 * shorter string would let a truncated response through to the verify gate,
 * where it would fail as "verification failed" rather than "malformed" — the
 * same symptom as a wrong device, in a path that only runs with a real phone
 * attached. So the shape is checked exactly, here, before the queue is touched.
 */

import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";

/**
 * A settled paired-phone sign callback: either the device's encoded signature
 * for a parked request, or that request's rejection.
 */
export type CompleteMobilePqSignRequest =
  | { readonly id: string; readonly signature: string }
  | { readonly error: string; readonly id: string };

// Deliberately not `isNetworkLabel` (shared/json): these are a queue id the
// wallet itself minted and a rejection code, matched exactly by the queue, not
// free text a user reads. Trimming or capping them would change which callbacks
// resolve a pending device signature, so this rule stays local and literal.
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Parses a `wallet.completeMobilePqSign` callback from the side panel, or
 * returns null when malformed. Accepts either a completed signature of exactly
 * the ML-DSA-65 encoded length or a rejection, never both and never neither.
 */
export const readCompleteMobilePqSignInput = (
  message: unknown,
): CompleteMobilePqSignRequest | null => {
  if (!isRecord(message) || message["type"] !== "wallet.completeMobilePqSign") {
    return null;
  }
  const id = message["id"];
  if (!isNonEmptyString(id)) {
    return null;
  }
  if (
    hasOnlyKnownKeys(message, ["id", "signature", "type"]) &&
    isMlDsa65Signature(message["signature"])
  ) {
    return { id, signature: message["signature"] };
  }
  if (hasOnlyKnownKeys(message, ["error", "id", "type"]) && isNonEmptyString(message["error"])) {
    return { error: message["error"], id };
  }
  return null;
};
