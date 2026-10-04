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
  | "blind-signing-disabled"
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
  "blind-signing-disabled":
    "Turn on Blind signing in the Starknet app settings on your Ledger, then retry.",
  "chain-failed": "Your transaction was submitted but failed on-chain.",
  "dashboard-restore-failed":
    "Your Ledger didn't return to its home screen for a compatibility check. Unlock it, leave it on the Starknet app, then try again.",
  "deploy-unfunded":
    "This account isn't deployed yet and has no STRK for the first transaction. Add STRK, then try again.",
  "device-busy":
    "Another app is using your Ledger. Close Ledger Live and any other tab using it, then try again.",
  "device-locked": "Unlock your Ledger, then try again.",
  "disconnected-mid-sign": "Your Ledger disconnected. Nothing was submitted.",
  "locked-mid-sign":
    "Your Ledger locked itself. Unlock it, then press Confirm again — you'll see the same request.",
  "management-refused":
    "Your Ledger refused a compatibility check. Unlock it, open the Starknet app, close Ledger Live, then try again.",
  "management-unreadable":
    "Your Ledger sent a reply Bramble couldn't read, so nothing was signed. Update the Starknet app in Ledger Live, then reconnect. If it keeps happening, report it.",
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
    "Your Ledger left the Starknet app for a compatibility check and couldn't reopen it. Open the Starknet app on your device, then try again. Nothing was signed.",
  "signature-verify-failed":
    "Couldn't verify the signature from your Ledger, so nothing was submitted. Try again.",
  "unexpected-device-error":
    "Something went wrong talking to your Ledger. Open the Starknet app, close other apps using it, then try again.",
  "unsupported-ledger-device":
    "This Ledger device or firmware isn't supported yet. Update it in Ledger Live, then reconnect and open the Starknet app.",
  "webhid-unavailable": "Ledger support needs a Chromium-based browser (Chrome, Brave, or Edge).",
  "worker-evicted": "The wallet restarted mid-sign. Reconnect your Ledger and try again.",
  "wrong-device":
    "This isn't the Ledger this account was set up on. Connect the one you originally used.",
};

/**
 * A typed Ledger rejection. `code` selects the catalog entry; `statusWord` is an
 * optional APDU status word for a support-facing detail line, never the headline.
 */
export class LedgerRejection extends Error {
  public readonly code: LedgerRejectionCode;
  public readonly statusWord: number | undefined;

  public constructor(code: LedgerRejectionCode, statusWord?: number) {
    super(code);
    this.name = "LedgerRejection";
    this.code = code;
    this.statusWord = statusWord;
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
 * Narrows an unknown thrown value to a {@link LedgerRejection}, or wraps it as
 * `unexpected-device-error`. Use at the UI boundary so a raw error is never
 * surfaced. Fails closed: anything unrecognized becomes the default rejection.
 */
export const asLedgerRejection = (error: unknown): LedgerRejection =>
  error instanceof LedgerRejection ? error : new LedgerRejection("unexpected-device-error");
