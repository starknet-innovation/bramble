/**
 * Validated, extension-origin protocol between the side panel and the dedicated
 * Ledger device window; Chrome cannot expose an affected Nano X through WebHID,
 * and Web Bluetooth does not provide `getDevices()` in stable Chrome, so the
 * top-level window that receives the user gesture must retain ownership of the
 * live transport while the side panel performs the current read or sign.
 *
 * The channel name contains an unguessable per-tab capability and both ends
 * validate every message. Only canonical mc-wallet Ledger paths and Stark field
 * hashes may reach the device. Responses carry public app/key data or a raw
 * signature over the caller-supplied hash; no seed, private key, vault secret,
 * raw transport error, or device identifier crosses the channel.
 */

import { isLedgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import { isStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import { isLedgerRejectionCode, type LedgerRejectionCode } from "./errors";

const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Prefix for the same-extension BroadcastChannel used by one Ledger window
 */
export const LEDGER_BROKER_CHANNEL_PREFIX = "mc-wallet-ledger-v1:";

/**
 * A validated session capability parsed from the grant-tab URL fragment.
 * Returns null for any missing or malformed value so an independently opened
 * grant page cannot expose a device command channel.
 */
export const ledgerBrokerSessionFromHash = (hash: string): string | null => {
  if (!hash.startsWith("#session=")) {
    return null;
  }
  try {
    const value = decodeURIComponent(hash.slice(9));
    return SESSION_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Builds the unique channel name for a validated session capability.
 */
export const ledgerBrokerChannelName = (sessionId: string): string =>
  `${LEDGER_BROKER_CHANNEL_PREFIX}${sessionId}`;

/**
 * Device operation request accepted by the retained Ledger window
 */
export type LedgerBrokerCommand =
  | { readonly id: number; readonly kind: "command"; readonly method: "getOsVersion" }
  | { readonly id: number; readonly kind: "command"; readonly method: "getAppVersion" }
  | {
      readonly id: number;
      readonly kind: "command";
      readonly method: "getPubKey";
      readonly path: string;
    }
  | {
      readonly hash: string;
      readonly id: number;
      readonly kind: "command";
      readonly method: "signHash";
      readonly path: string;
    }
  | { readonly kind: "close" };

/**
 * Device-window response understood by the side-panel proxy.
 */
export type LedgerBrokerResponse =
  | { readonly kind: "ready" }
  | {
      readonly error: LedgerRejectionCode;
      readonly id: number;
      readonly kind: "response";
      readonly ok: false;
    }
  | {
      readonly id: number;
      readonly kind: "response";
      readonly ok: true;
      readonly value: unknown;
    };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRequestId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * Validates an untrusted side-panel message before it can reach the hardware.
 */
export const isLedgerBrokerCommand = (value: unknown): value is LedgerBrokerCommand => {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    return false;
  }
  if (value["kind"] === "close") {
    return Object.keys(value).length === 1;
  }
  if (
    value["kind"] !== "command" ||
    !isRequestId(value["id"]) ||
    typeof value["method"] !== "string"
  ) {
    return false;
  }
  if (value["method"] === "getOsVersion" || value["method"] === "getAppVersion") {
    return Object.keys(value).length === 3;
  }
  if (value["method"] === "getPubKey") {
    return Object.keys(value).length === 4 && isLedgerAccountPath(value["path"]);
  }
  return (
    value["method"] === "signHash" &&
    Object.keys(value).length === 5 &&
    isLedgerAccountPath(value["path"]) &&
    typeof value["hash"] === "string" &&
    isStarkFieldElement(value["hash"])
  );
};

/**
 * Validates an untrusted device-window response before the side panel resolves
 * a pending command. Unknown error codes and malformed response ids fail closed.
 */
export const isLedgerBrokerResponse = (value: unknown): value is LedgerBrokerResponse => {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    return false;
  }
  if (value["kind"] === "ready") {
    return Object.keys(value).length === 1;
  }
  if (
    value["kind"] !== "response" ||
    !isRequestId(value["id"]) ||
    typeof value["ok"] !== "boolean"
  ) {
    return false;
  }
  if (value["ok"]) {
    return Object.keys(value).length === 4 && Object.hasOwn(value, "value");
  }
  return Object.keys(value).length === 4 && isLedgerRejectionCode(value["error"]);
};
