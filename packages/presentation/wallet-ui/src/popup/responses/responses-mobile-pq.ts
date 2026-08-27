/**
 * Panel-facing validators for the privileged paired-phone responses. Each parses
 * an untrusted background reply at the boundary into a precise type, so a
 * malformed hash, account id, or a public key of the wrong length can never
 * reach the transport flow. No secret material crosses: a phone reply carries a
 * queue id, a hash, a device id, and a public ML-DSA-65 key.
 */
import { hasOnlyKnownKeys, isJson, isRecord } from "@mc-wallet/core/json";
import { isAccountId } from "@mc-wallet/wallet-model/accounts";
import { isStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import { isMlDsa65PublicKey } from "@mc-wallet/wallet-model/signing";

/**
 * A pending sign the side panel that owns the transport must fulfil: the
 * background queue id, the account it belongs to, the host-computed hash the
 * phone blind-signs, the device the account was paired with, and the enrolled
 * public key so the panel can reject a re-installed or wrong device before the
 * biometric prompt. Carries no secret material — the ML-DSA key never leaves the
 * phone's hardware and this one is its public half.
 */
export type MobilePqSignRequestSummary = {
  readonly accountId: string;
  readonly deviceId: string;
  readonly id: string;
  readonly messageHash: string;
  readonly publicKey: string;
};

/**
 * Pending paired-phone sign requests accepted from the background boundary.
 */
export type MobilePqSignPendingResponse = {
  readonly ok: true;
  readonly pending: readonly MobilePqSignRequestSummary[];
};

const isMobilePqSignRequestSummary = (value: unknown): value is MobilePqSignRequestSummary =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "deviceId", "id", "messageHash", "publicKey"]) &&
  typeof value["id"] === "string" &&
  value["id"].length > 0 &&
  typeof value["deviceId"] === "string" &&
  value["deviceId"].length > 0 &&
  isAccountId(value["accountId"]) &&
  typeof value["messageHash"] === "string" &&
  isStarkFieldElement(value["messageHash"]) &&
  isMlDsa65PublicKey(value["publicKey"]);

/**
 * Checks pending paired-phone responses before the panel builds an envelope for
 * the device, so a malformed hash or a key of the wrong length can never be
 * handed out for signing.
 */
export const isMobilePqSignPendingResponse = (
  value: unknown,
): value is MobilePqSignPendingResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["ok", "pending"]) &&
  value["ok"] === true &&
  Array.isArray(value["pending"]) &&
  value["pending"].every(isMobilePqSignRequestSummary);
