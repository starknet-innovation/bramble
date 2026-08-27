/**
 * The M1 clipboard envelope: the request the panel hands a paired phone, as one
 * base64url string a user can copy, and the response shape it hands back.
 *
 * JSON rather than the CBOR the wire contract specifies, and built here rather
 * than in Rust, because a blind-signing phone needs no shared codec: it signs
 * the 32 bytes it is given. When the phone recomputes the hash itself it will
 * need the full transaction, and that envelope is defined once in krusty-kms and
 * reaches both consumers through WASM and the C ABI. This module is what that
 * replaces — it is deliberately small, and deliberately not a second contract.
 *
 * Self-contained by design: no shared references and no session state beyond the
 * pairing, which is what makes a clipboard transport possible at all, and a
 * clipboard transport is what makes the whole flow testable without hardware.
 */

import type { MobilePqSignRequestSummary } from "../../../popup/responses/responses";

/**
 * Envelope version. The phone refuses an envelope it does not recognise rather
 * than guessing at fields, so this must move whenever the shape below changes.
 */
export const MOBILE_PQ_ENVELOPE_VERSION = 1;

const base64url = (value: string): string =>
  btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

/**
 * Encodes one parked request as the base64url string the user carries to the
 * phone. Blind signing at this milestone: the payload is the transaction hash,
 * not the transaction, so the phone can verify nothing about what it approves —
 * which is why the extension still verifies the returned signature before
 * anything is broadcast.
 */
export const encodeMobilePqSignEnvelope = (request: MobilePqSignRequestSummary): string =>
  base64url(
    JSON.stringify({
      accountId: request.accountId,
      correlationId: request.id,
      deviceId: request.deviceId,
      messageHash: request.messageHash,
      publicKey: request.publicKey,
      version: MOBILE_PQ_ENVELOPE_VERSION,
    }),
  );
