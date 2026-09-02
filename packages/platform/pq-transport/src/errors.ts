/**
 * The paired-phone Bluetooth transport's rejection catalog: one typed code per
 * failure a round trip can hit, plus the exact user-facing copy for each. Every
 * transport failure is reduced to one of these, so the panel never renders a raw
 * `DOMException` or GATT error as a headline, and every rejection aborts with
 * nothing signed and nothing submitted.
 *
 * Deliberately much smaller than the Ledger catalog. A code exists only where
 * something in this transport can actually produce it.
 *
 * Four of them are named by the PHONE, not observed here: a refusal frame
 * carries a reason, and {@link pqRefusalCode} maps it. That mapping is the whole
 * point of the refusal tag — before it existed, a user who declined got "the
 * phone sent something this wallet does not recognise", which is both wrong and
 * unactionable.
 *
 * Trust boundary: these are presentation values, not authority. A rejection only
 * tells the user what happened; it never authorizes a state change.
 */

/**
 * Internal rejection codes covering the whole Bluetooth flow: capability,
 * chooser, connection, framing, and the panel-to-tab channel.
 */
export type PqRejectionCode =
  | "bluetooth-unavailable"
  | "picker-cancelled"
  | "device-busy"
  | "device-unreachable"
  | "rejected-on-device"
  | "wrong-device"
  | "network-mismatch"
  | "unreadable-request"
  | "device-lost"
  | "protocol-mismatch"
  | "payload-too-large"
  | "malformed-reply"
  | "panel-context-lost"
  | "request-timeout"
  | "unexpected-device-error";

const PQ_MESSAGES: Readonly<Record<PqRejectionCode, string>> = {
  "bluetooth-unavailable":
    "This browser can't use Bluetooth. Use the copy-and-paste transport instead, or try Chrome on desktop.",
  "device-busy":
    "Your phone is already handling another request. Wait for that one to finish, then try again.",
  "device-lost":
    "The connection to your phone dropped. Nothing was submitted. Reconnect and try again.",
  "device-unreachable":
    "Couldn't reach your phone. Open the signer app, keep it on screen, and make sure Bluetooth is on.",
  "network-mismatch":
    "That phone's key was registered for a different network. Switch networks, or use the phone this account was set up on.",
  "rejected-on-device": "You rejected the request on your phone. Nothing was submitted.",
  "unreadable-request":
    "Your phone could not read the request. Update the signer app, then try again.",
  "wrong-device":
    "This phone holds no key for this account. Connect the phone this account was set up on.",
  "malformed-reply":
    "Your phone sent something this wallet doesn't recognize, so nothing was submitted. Check that the app is up to date.",
  "panel-context-lost": "The Bluetooth tab closed before you confirmed. Nothing was submitted.",
  "payload-too-large":
    "This request is too large to send over Bluetooth. Use the copy-and-paste transport for it.",
  "picker-cancelled":
    "No phone was chosen. Open the signer app, tap Connect, then pick it in the browser's list.",
  "protocol-mismatch":
    "Your phone's signer app speaks a different version of this protocol. Update the app, then try again.",
  "request-timeout":
    "Your phone didn't answer in time. Nothing was submitted — approve it on the phone, or try again.",
  "unexpected-device-error":
    "Something went wrong talking to your phone. Keep the signer app on screen, then try again.",
};

/**
 * A typed transport rejection. `code` selects the catalog entry above; no raw
 * browser error, device identifier, or GATT detail is ever carried.
 */
export class PqRejection extends Error {
  public readonly code: PqRejectionCode;

  public constructor(code: PqRejectionCode) {
    super(code);
    this.name = "PqRejection";
    this.code = code;
  }
}

/**
 * The user-facing message for a rejection code. Total over the code union, so a
 * new code cannot ship without copy.
 */
export const pqMessage = (code: PqRejectionCode): string => PQ_MESSAGES[code];

/**
 * Narrows an untrusted value to a code actually present in the single-source
 * message catalog. Used on the channel boundary, where the error code arrives
 * from the device tab and must not be trusted as a string.
 */
export const isPqRejectionCode = (value: unknown): value is PqRejectionCode =>
  typeof value === "string" && Object.hasOwn(PQ_MESSAGES, value);

// What the phone puts in a refusal frame's payload. Kept as a wire vocabulary
// separate from the code union: the phone may learn a new reason before this
// build knows it, and an unrecognised one must degrade to something true rather
// than be reported as a wallet error.
const REFUSAL_CODES: Readonly<Record<string, PqRejectionCode>> = {
  declined: "rejected-on-device",
  "no-key": "wrong-device",
  unreadable: "unreadable-request",
  "wrong-network": "network-mismatch",
};

/**
 * Maps a refusal reason the phone sent to a rejection code.
 *
 * An unrecognised reason becomes `rejected-on-device`, which is the honest
 * default: the phone refused, this build cannot say why, and telling the user
 * their phone declined is true where reporting a wallet error would not be.
 */
export const pqRefusalCode = (reason: string): PqRejectionCode =>
  REFUSAL_CODES[reason] ?? "rejected-on-device";

/**
 * Narrows an unknown thrown value to a {@link PqRejection}, or wraps it as
 * `unexpected-device-error`. Use at every boundary that catches, so a raw error
 * is never surfaced. Fails closed: anything unrecognized becomes the default.
 */
export const asPqRejection = (error: unknown): PqRejection =>
  error instanceof PqRejection ? error : new PqRejection("unexpected-device-error");
