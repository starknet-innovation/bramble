/**
 * Classifies a thrown browser or Ledger transport error into the fixed
 * rejection catalog. One place owns the patterns: the side-panel open path
 * and the APDU client both call it, so a stale handle cannot be labelled as
 * another app in one layer and not the other.
 *
 * Chromium's own strings are matched narrowly. "Unable to claim interface."
 * is the WebUSB failure when a different document or process holds the
 * interface. "The device is already open." is WebHID refusing a second open
 * of this document's own handle. "The specified interface has not been
 * claimed." is a transfer on a connection this page already released. Neither
 * of those is another app. Ledger's exchange lock and "action already pending"
 * are the same page racing itself.
 */

import {
  LedgerRejection,
  type LedgerRejectionCode,
  ledgerCauseName,
} from "@bramble/ledger-protocol/errors";

/**
 * How a thrown transport error should be shown, and whether the caller may
 * close its own handle and try the open or read once more.
 */
export type LedgerTransportFailure = {
  readonly causeName: string | undefined;
  readonly code: LedgerRejectionCode;
  readonly ownStale: boolean;
};

// Ledger wraps Chromium's claim failure as TransportInterfaceNotAvailable and
// keeps the original message. A different holder is the only case that copy
// may call "something else".
const OTHER_HOLDER = /unable to claim interface|transportinterfacenotavailable/i;

// This page's own handle or an overlapping call on it. Retry once after close;
// do not tell the reader another app has the device.
const OWN_STALE =
  /already open|has not been claimed|already pending|state is in progress|device is busy \(lock|transportracecondition/i;

const NO_APP = /\b(?:0x6d00|0x6e00|0x6e01|INS_NOT_SUPPORTED|CLA_NOT_SUPPORTED)\b/i;

const textOf = (error: unknown): string =>
  error instanceof Error ? `${error.name} ${error.message}` : "";

/**
 * Reduces a thrown transport error to a catalog code. A {@link LedgerRejection}
 * passes through unchanged, including its cause name and stale-handle flag.
 * Unrecognized throws become `unexpected-device-error`.
 */
export const classifyLedgerTransportError = (error: unknown): LedgerTransportFailure => {
  if (error instanceof LedgerRejection) {
    return { causeName: error.causeName, code: error.code, ownStale: error.ownStale };
  }
  const text = textOf(error);
  const causeName = ledgerCauseName(error);
  if (OTHER_HOLDER.test(text)) {
    return { causeName, code: "device-busy", ownStale: false };
  }
  if (OWN_STALE.test(text)) {
    // `replug`, not the catch-all: these fail before the device signs, and
    // the submit outcome must stay "nothing was sent" (PRE_SIGNATURE codes).
    return { causeName, code: "replug", ownStale: true };
  }
  if (NO_APP.test(text)) {
    return { causeName, code: "no-app-open", ownStale: false };
  }
  if (/locked/i.test(text)) {
    return { causeName, code: "device-locked", ownStale: false };
  }
  if (/disconnect/i.test(text)) {
    return { causeName, code: "disconnected-mid-sign", ownStale: false };
  }
  return { causeName, code: "unexpected-device-error", ownStale: false };
};

/**
 * The catalog rejection for a thrown transport error. The hardware-tab broker
 * uses this before an error crosses its channel, so the message stays in the
 * document that caught it and only the code and class name leave.
 */
export const ledgerTransportRejection = (error: unknown): LedgerRejection => {
  if (error instanceof LedgerRejection) return error;
  const failure = classifyLedgerTransportError(error);
  return new LedgerRejection(failure.code, undefined, {
    ...(failure.causeName ? { causeName: failure.causeName } : {}),
    ...(failure.ownStale ? { ownStale: true } : {}),
  });
};
