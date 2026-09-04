/**
 * The reply a phone sends after proving it holds a key, and the checks on it.
 *
 * Its own module because two journeys decode it. Enrollment reads it after the
 * phone has created a key; restore reads the identical shape after the phone has
 * proved a key it already had. That is deliberate rather than incidental — once
 * the key exists the two are the same operation, and giving them one wire shape
 * is what puts the wallet's proof-of-possession gate on both paths instead of
 * only the one it was written for.
 *
 * Kept out of either controller so neither has to import the other.
 */

import { isMlDsa65PublicKey, isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";
import { fromBase64Url } from "./wire-encoding";

/**
 * What the user types or pastes into the enrollment form.
 */
export type MobilePqEnrollDraft = {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly signature: string;
};

/**
 * Pairing envelope version. The phone refuses a version it does not recognise
 * rather than guessing at fields, so this moves whenever a shape below changes.
 */
export const MOBILE_PQ_PAIRING_VERSION = 1;

/**
 * What the phone sends back: the name it gave the key, the public key, and the
 * signature over the challenge.
 */
export type MobilePqPairingResult = {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly signature: string;
};

/**
 * Decodes a pasted pairing response, or null when it is not one.
 *
 * Shape only: the lengths of the key and the signature, and the signature
 * itself, are checked by the enrollment controller and the background. This
 * refuses anything that is not the right *kind* of value so the caller can say
 * "that is not a response from the app" rather than "invalid public key".
 */
export const decodeMobilePqPairingResult = (pasted: string): MobilePqPairingResult | null => {
  const json = fromBase64Url(pasted);
  if (json === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const { deviceId, publicKey, signature, version } = record;
  if (
    version !== MOBILE_PQ_PAIRING_VERSION ||
    typeof deviceId !== "string" ||
    deviceId.trim().length === 0 ||
    typeof publicKey !== "string" ||
    typeof signature !== "string"
  ) {
    return null;
  }
  return { deviceId: deviceId.trim(), publicKey, signature };
};

/**
 * Copy shown when a pasted public key is not a well-formed ML-DSA-65 key.
 */
export const MOBILE_PQ_KEY_INVALID =
  "That is not an ML-DSA-65 public key. Paste the whole 1952-byte value the app reported.";

/**
 * Copy shown when a pasted proof-of-possession response is malformed.
 */
export const MOBILE_PQ_POP_INVALID =
  "That is not a signature from the app. Sign the challenge above and paste the whole response.";

/**
 * Checks a decoded reply's key and proof are well formed, returning the copy to
 * show or `null` when both are.
 *
 * Shared with the restore path, which decodes the same reply shape and has to
 * refuse the same malformed values — a second copy of these two checks would be
 * a second opinion about what the phone is allowed to send.
 *
 * The device name is not checked here: it comes from inside the reply, so an
 * empty one means a malformed reply rather than a field the user left blank, and
 * the decoder refuses it before this runs.
 */
export const mobilePqDraftError = (draft: MobilePqEnrollDraft): string | null => {
  if (!isMlDsa65PublicKey(draft.publicKey)) {
    return MOBILE_PQ_KEY_INVALID;
  }
  return isMlDsa65Signature(draft.signature) ? null : MOBILE_PQ_POP_INVALID;
};
