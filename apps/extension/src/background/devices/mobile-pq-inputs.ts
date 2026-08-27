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
import { isMlDsaKind, type MlDsaKind } from "@mc-wallet/wallet-model/accounts";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import { isMlDsa65PublicKey, isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";

// Matches the bound the account model puts on a stored device id, so a record
// the wallet would refuse to persist is refused at the message boundary instead.
const MAX_DEVICE_ID_LENGTH = 64;

/**
 * A parsed request to enroll a paired device. The public key and the class hash
 * are both pasted by the user at this milestone, so both are validated exactly
 * here: a key of the wrong length or a non-felt class hash would otherwise reach
 * address derivation and produce an address nobody can spend from.
 */
export type AddMobilePqAccountRequest = {
  readonly challenge: string;
  readonly classHash: string;
  readonly deviceId: string;
  readonly mlDsaKind: MlDsaKind;
  readonly networkId: StarknetNetworkId;
  readonly publicKey: string;
  readonly signature: string;
};

/**
 * Parses a `wallet.addMobilePqAccount` request, or returns null when malformed.
 * The signature is the device's proof of possession over `challenge`; this
 * parser checks its shape only, and the handler verifies it.
 */
export const readAddMobilePqAccountInput = (message: unknown): AddMobilePqAccountRequest | null => {
  if (
    !isRecord(message) ||
    message["type"] !== "wallet.addMobilePqAccount" ||
    !hasOnlyKnownKeys(message, [
      "challenge",
      "classHash",
      "deviceId",
      "mlDsaKind",
      "networkId",
      "publicKey",
      "signature",
      "type",
    ])
  ) {
    return null;
  }
  const { challenge, classHash, deviceId, mlDsaKind, networkId, publicKey, signature } = message;
  if (
    typeof challenge !== "string" ||
    !isStarkFieldElement(challenge) ||
    typeof classHash !== "string" ||
    !isNonZeroStarkFieldElement(classHash) ||
    typeof deviceId !== "string" ||
    deviceId.length === 0 ||
    deviceId.length > MAX_DEVICE_ID_LENGTH ||
    !isMlDsaKind(mlDsaKind) ||
    !isStarknetNetworkId(networkId) ||
    !isMlDsa65PublicKey(publicKey) ||
    !isMlDsa65Signature(signature)
  ) {
    return null;
  }
  return { challenge, classHash, deviceId, mlDsaKind, networkId, publicKey, signature };
};

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
