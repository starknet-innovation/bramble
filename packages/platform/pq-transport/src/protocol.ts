/**
 * Validated, extension-origin protocol between the side panel and the dedicated
 * Bluetooth device tab.
 *
 * The chooser cannot run in the side panel. That was measured, not assumed:
 * `requestDevice` there rejects with `NotFoundError` in single-digit
 * milliseconds, no chooser window ever appears, and `getAvailability()` reports
 * a healthy adapter in the same handler — while the same page hosted in an
 * ordinary tab pairs normally. So the gesture-owning tab holds the GATT
 * connection and the panel drives it across this channel, exactly as the Ledger
 * flow does. Stable Chrome also has no `Bluetooth.getDevices()`, and a
 * `BluetoothDevice` cannot be structured-cloned to another realm, so the context
 * that ran the chooser is the only one that can keep the connection.
 *
 * The channel name carries an unguessable per-tab capability and both ends
 * validate every message. Everything crossing is public by construction: a
 * base64url request the panel already built, and the phone's reply. The
 * background verifies that reply against the enrolled public key before anything
 * is broadcast, so this boundary's job is shape discipline, not confidentiality.
 *
 * **Shape discipline here means a key allowlist plus explicit lengths, never an
 * exact key count.** The Ledger broker checks `Object.keys(response).length !==
 * 4` against a library that returns five fields, which rejected every Bluetooth
 * signing reply it ever saw — and its hand-written test fixture agreed with the
 * count, so fixture and validator were consistent with each other and wrong
 * about the device. Two rules follow, and they are why this module exists
 * separately from its callers: allowlist the keys, and take test fixtures from
 * the phone's own emitter rather than writing them here.
 */

import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isMlDsa65Signature } from "@mc-wallet/wallet-model/signing";
import { isPqRejectionCode, type PqRejectionCode } from "./errors";
import { PQ_MAX_PAYLOAD_BYTES } from "./framing";

const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SESSION_HASH_PREFIX = "#session=";

/**
 * Prefix for the same-extension BroadcastChannel used by one device tab. Its own
 * namespace, so a Ledger broker message can never be parsed as a phone command.
 */
export const PQ_BROKER_CHANNEL_PREFIX = "mc-wallet-pq-v1:";

/**
 * A validated session capability parsed from the device-tab URL fragment.
 * Returns null for any missing or malformed value, so a device page someone
 * opened independently cannot expose a command channel.
 */
export const pqBrokerSessionFromHash = (hash: string): string | null => {
  if (!hash.startsWith(SESSION_HASH_PREFIX)) {
    return null;
  }
  try {
    const value = decodeURIComponent(hash.slice(SESSION_HASH_PREFIX.length));
    return SESSION_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Builds the unique channel name for a validated session capability.
 */
export const pqBrokerChannelName = (sessionId: string): string =>
  `${PQ_BROKER_CHANNEL_PREFIX}${sessionId}`;

/**
 * Checks a value is one of the base64url strings this transport carries — a
 * pairing offer, a signing envelope, or the phone's pairing reply — bounded by
 * what one frame can hold. Grammar and length only: this module never decodes a
 * payload, because encoders and decoders already exist on both sides and a third
 * copy would drift.
 *
 * One direction is NOT distinguishable here, and callers must not try: lowercase
 * hex is itself valid base64url, so a signing reply satisfies this check too.
 * Which validator applies is decided by the command that was sent, never by
 * sniffing the string — {@link isPqSignedReply} is the one to use on a `sign`
 * reply.
 */
export const isPqTransportPayload = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= PQ_MAX_PAYLOAD_BYTES &&
  BASE64URL_PATTERN.test(value);

/**
 * Checks a value is the phone's signing reply: lowercase `0x` hex over exactly
 * 3309 bytes. Delegates length and grammar to the single-source ML-DSA check, so
 * this transport cannot disagree with the clipboard one about what a well-formed
 * reply is. Shape only — the background still verifies it against the enrolled
 * key before anything is broadcast.
 */
export const isPqSignedReply = (value: unknown): value is string => isMlDsa65Signature(value);

/**
 * Device operation requested by the panel and served by the retained tab.
 *
 * Four methods: enroll a new key, sign, and the two halves of a restore — ask
 * which existing accounts the user picked, then ask one of them to prove itself.
 * The restore pair is two commands because it is two frames; see `./framing`.
 */
export type PqBrokerCommand =
  | {
      readonly id: number;
      readonly kind: "command";
      readonly method: "pair";
      readonly offer: string;
    }
  | {
      readonly envelope: string;
      readonly id: number;
      readonly kind: "command";
      readonly method: "sign";
    }
  | {
      readonly id: number;
      readonly kind: "command";
      readonly method: "restore";
      readonly offer: string;
    }
  | {
      readonly id: number;
      readonly kind: "command";
      readonly method: "restore-key";
      readonly offer: string;
    }
  | { readonly kind: "close" };

/**
 * Device-tab response understood by the panel proxy. `value` is the reply string
 * as the phone sent it; which kind of string it must be depends on the command
 * it answers, so the caller narrows it with {@link isPqSignedReply} or
 * {@link isPqPairingReply} rather than this module guessing.
 */
export type PqBrokerResponse =
  | { readonly kind: "ready" }
  | {
      readonly error: PqRejectionCode;
      readonly id: number;
      readonly kind: "response";
      readonly ok: false;
    }
  | {
      readonly id: number;
      readonly kind: "response";
      readonly ok: true;
      readonly value: string;
    };

const isRequestId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * Validates an untrusted panel message before the tab acts on it. Key-allowlisted
 * per method, so an unknown field is a refusal rather than something that rides
 * along, and a payload that is not the right grammar never reaches the device.
 */
export const isPqBrokerCommand = (value: unknown): value is PqBrokerCommand => {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    return false;
  }
  if (value["kind"] === "close") {
    return hasOnlyKnownKeys(value, ["kind"]);
  }
  if (value["kind"] !== "command" || !isRequestId(value["id"])) {
    return false;
  }
  if (
    value["method"] === "pair" ||
    value["method"] === "restore" ||
    value["method"] === "restore-key"
  ) {
    return (
      hasOnlyKnownKeys(value, ["id", "kind", "method", "offer"]) &&
      isPqTransportPayload(value["offer"])
    );
  }
  return (
    value["method"] === "sign" &&
    hasOnlyKnownKeys(value, ["envelope", "id", "kind", "method"]) &&
    isPqTransportPayload(value["envelope"])
  );
};

/**
 * Validates an untrusted device-tab response before the panel settles a pending
 * command. An unknown error code and a malformed id both fail closed, and a
 * successful reply must carry a string within one frame's bound — the caller
 * then checks it is the right kind of string for the command it answers.
 */
export const isPqBrokerResponse = (value: unknown): value is PqBrokerResponse => {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    return false;
  }
  if (value["kind"] === "ready") {
    return hasOnlyKnownKeys(value, ["kind"]);
  }
  if (value["kind"] !== "response" || !isRequestId(value["id"])) {
    return false;
  }
  if (value["ok"] === true) {
    return (
      hasOnlyKnownKeys(value, ["id", "kind", "ok", "value"]) &&
      typeof value["value"] === "string" &&
      value["value"].length > 0 &&
      value["value"].length <= PQ_MAX_PAYLOAD_BYTES
    );
  }
  return (
    value["ok"] === false &&
    hasOnlyKnownKeys(value, ["error", "id", "kind", "ok"]) &&
    isPqRejectionCode(value["error"])
  );
};
