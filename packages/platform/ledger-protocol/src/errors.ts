/**
 * The Ledger graceful-rejection catalog: one typed code per failure the device
 * flow can hit, plus the exact user-facing copy for each. Every device/transport
 * failure is mapped to one of these so the UI never renders a raw JS error or an
 * APDU status word as a headline, and every rejection aborts with nothing
 * submitted. Internal codes are kept separate from user copy on purpose.
 *
 * Trust boundary: these are presentation values, not authority — a rejection
 * here only tells the user what happened; it never authorizes a state change.
 */

/**
 * Internal rejection codes covering the whole Ledger flow (connect, enumerate,
 * sign, submit). The `default` mapping is always `unexpected-device-error`.
 */
export type LedgerRejectionCode =
  | "webhid-unavailable"
  | "picker-cancelled"
  | "device-locked"
  | "no-app-open"
  | "firmware-below-minimum"
  | "app-below-minimum"
  | "unsupported-ledger-device"
  | "rejected-or-blind-signing-off"
  | "device-busy"
  | "replug"
  | "multiple-devices"
  | "wrong-device"
  | "network-mismatch"
  | "deploy-unfunded"
  | "rejected-on-device"
  | "locked-mid-sign"
  | "disconnected-mid-sign"
  | "panel-context-lost"
  | "sign-timeout"
  | "signature-verify-failed"
  | "worker-evicted"
  | "chain-failed"
  | "management-refused"
  | "management-unreadable"
  | "dashboard-restore-failed"
  | "starknet-reopen-failed"
  | "unexpected-device-error";

const LEDGER_MESSAGES: Readonly<Record<LedgerRejectionCode, string>> = {
  "app-below-minimum":
    "Your Ledger's Starknet app needs an update. Update it in Ledger Live, then reconnect and open Starknet.",
  // The Starknet app (2.4.0 to 2.4.3) answers a sign-hash refusal with the same
  // status whether the user rejected it or Blind signing is off (and a
  // mid-sign transport failure looks the same), so this copy names no cause
  // as fact. Owner-approved wording (mc-wallet 877, 2026-11-06).
  "rejected-or-blind-signing-off":
    "Signing couldn't be completed. You may have rejected the request, or Blind signing may be off. Check your Ledger and its connection before retrying.",
  "chain-failed": "Your transaction was submitted but failed on-chain.",
  "dashboard-restore-failed":
    "Your Ledger didn't return to its home screen. Unlock it, leave it on the Starknet app, then try again.",
  "deploy-unfunded":
    "This account isn't deployed yet and has no STRK for the first transaction. Add STRK, then try again.",
  "device-busy":
    "Something else is using your Ledger. Close other wallet apps and Bramble windows, unplug and replug it, then try again.",
  "device-locked": "Unlock your Ledger, then try again.",
  "disconnected-mid-sign": "Your Ledger disconnected. Nothing was submitted.",
  "locked-mid-sign":
    "Your Ledger locked itself. Unlock it, then press Confirm again — you'll see the same request.",
  "management-refused":
    "Your Ledger refused a compatibility check. Unlock it, open the Starknet app, close Ledger Live, then try again.",
  "management-unreadable":
    "Your Ledger's app or firmware is newer than this wallet supports. Nothing was signed.",
  "multiple-devices": "Select the Ledger for this account.",
  "network-mismatch":
    "This Ledger account was set up for another network. Switch networks or pick a matching account.",
  "no-app-open":
    "Open the Starknet app on your Ledger. If Ledger Live can't install it, update your firmware first (My Ledger), then open the app.",
  "firmware-below-minimum":
    "Your Ledger firmware needs an update. Update it in Ledger Live (My Ledger), then reconnect and open the Starknet app.",
  "panel-context-lost": "The Ledger tab closed before you confirmed. Nothing was submitted.",
  "picker-cancelled":
    "No Ledger was chosen. Connect it by USB, unlock it, open the Starknet app, then try again.",
  "rejected-on-device": "You rejected the request on your Ledger. Nothing was submitted.",
  replug: "Reconnect your Ledger, then try again.",
  "sign-timeout": "Still waiting for you to confirm on your Ledger.",
  "starknet-reopen-failed":
    "Your Ledger couldn't reopen the Starknet app. Open it on your device, then try again. Nothing was signed.",
  "signature-verify-failed":
    "Couldn't verify the signature from your Ledger, so nothing was submitted. Try again.",
  "unexpected-device-error":
    "Something went wrong talking to your Ledger. Unlock it, open the Starknet app, close other wallets and Bramble windows, then unplug it and try again.",
  "unsupported-ledger-device":
    "This Ledger device or firmware isn't supported yet. Update it in Ledger Live, then reconnect and open the Starknet app.",
  "webhid-unavailable": "Ledger support needs a Chromium-based browser (Chrome, Brave, or Edge).",
  "worker-evicted": "The wallet restarted mid-sign. Reconnect your Ledger and try again.",
  "wrong-device":
    "This isn't the Ledger this account was set up on. Connect the one you originally used.",
};

/**
 * Optional detail carried beside a catalog code. `causeName` is the thrown
 * error's class name (a short token, never its message) so a support line can
 * tell two failures with the same sentence apart. `ownStale` marks a failure
 * of this page's own handle; callers may close and retry once, and it never
 * authorizes a second signature.
 */
export type LedgerRejectionDetail = {
  readonly causeName?: string;
  readonly ownStale?: boolean;
};

// A support line may name an error class. Messages, paths, and device text
// fail this and are dropped.
const CAUSE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;
const OPAQUE_CAUSE = new Set(["DOMException", "Error", "LedgerRejection"]);

const causeFrom = (value: string | undefined): string | undefined =>
  value !== undefined && CAUSE_NAME.test(value) && !OPAQUE_CAUSE.has(value) ? value : undefined;

/**
 * True when `value` is a short error-class token safe to show in a support
 * line or to cross the hardware-tab channel. Rejects messages and opaque
 * built-in names.
 */
export const isLedgerCauseToken = (value: unknown): value is string =>
  typeof value === "string" && causeFrom(value) === value;

/**
 * The thrown error's class name when it is safe to show, or undefined for a
 * message, a non-error, or an opaque name like `Error`.
 */
export const ledgerCauseName = (error: unknown): string | undefined =>
  error instanceof LedgerRejection
    ? error.causeName
    : error instanceof Error
      ? causeFrom(error.name)
      : undefined;

/**
 * A typed Ledger rejection. `code` selects the catalog entry; `statusWord` is an
 * optional APDU status word for a support-facing detail line, never the headline.
 * `causeName` is the underlying error class, also never the headline.
 */
export class LedgerRejection extends Error {
  public readonly causeName: string | undefined;
  public readonly code: LedgerRejectionCode;
  public readonly ownStale: boolean;
  public readonly statusWord: number | undefined;

  public constructor(
    code: LedgerRejectionCode,
    statusWord?: number,
    detail?: LedgerRejectionDetail,
  ) {
    super(code);
    this.name = "LedgerRejection";
    this.code = code;
    this.statusWord = statusWord;
    this.causeName = causeFrom(detail?.causeName);
    this.ownStale = detail?.ownStale === true;
  }
}

/**
 * The user-facing message for a rejection code. Total over the code union, so a
 * new code cannot ship without copy.
 */
export const ledgerMessage = (code: LedgerRejectionCode): string => LEDGER_MESSAGES[code];

/**
 * Narrows an untrusted value to a code actually present in the single-source
 * Ledger message catalog.
 */
export const isLedgerRejectionCode = (value: unknown): value is LedgerRejectionCode =>
  typeof value === "string" && Object.hasOwn(LEDGER_MESSAGES, value);

/**
 * Support line for an ambiguous device failure. Present for `device-busy`,
 * `unexpected-device-error`, and any rejection that carries a cause name, so a
 * report can tell those screens apart. Other catalog sentences already name
 * the failure and stay without a second line.
 */
export const ledgerErrorSupportCode = (rejection: LedgerRejection): string | undefined => {
  if (
    rejection.causeName === undefined &&
    rejection.code !== "device-busy" &&
    rejection.code !== "unexpected-device-error"
  ) {
    return undefined;
  }
  return rejection.causeName
    ? `Support code · ${rejection.code} · ${rejection.causeName}`
    : `Support code · ${rejection.code}`;
};

/**
 * Appends a safe cause name to a support line that already identifies the
 * stage. The cause is omitted when the error has no class name worth showing.
 */
export const appendLedgerCause = (line: string, error: unknown): string => {
  const cause = ledgerCauseName(error);
  return cause ? `${line} · ${cause}` : line;
};

/**
 * Narrows an unknown thrown value to a {@link LedgerRejection}, or wraps it as
 * `unexpected-device-error`. Use at the UI boundary so a raw error is never
 * surfaced. Fails closed: anything unrecognized becomes the default rejection.
 * A safe class name is kept for the support line; the message is not.
 */
export const asLedgerRejection = (error: unknown): LedgerRejection => {
  if (error instanceof LedgerRejection) return error;
  const causeName = ledgerCauseName(error);
  return new LedgerRejection(
    "unexpected-device-error",
    undefined,
    causeName ? { causeName } : undefined,
  );
};
