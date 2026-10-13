/**
 * Decides which user-facing sentence a raw error string earns.
 *
 * Raw diagnostics reach here from two places: the background's own `error`
 * field, and the runtime client's fallback when a reply is unrecognised. Either
 * way the string was written for a developer, and an unrecognised one is shown
 * to the reader verbatim — which is how "add token failed" reached a toast. The
 * table below is what stands between the two.
 *
 * The wording lives in ./friendly-error-copy; this file is only the mapping
 * from a raw string to one of those. It is a pure lookup with no DOM, clock, or
 * network access. Error toasts keep the original diagnostic behind their copy
 * control, so nothing translated here is lost to a bug report.
 */

import { friendlyNetworkError } from "@bramble/core/network-error";
import { isLedgerRejectionCode, ledgerMessage } from "@bramble/ledger-protocol/errors";
import {
  ERROR_COPY,
  GENERIC_VALIDATION,
  RATE_LIMITED,
  RPC_REJECTED,
  SERVICE_REJECTED,
  UNEXPECTED_FALLBACK,
} from "./friendly-error-copy";
import { FACT_KEPT, FACT_TERMS, isInternalDiagnostic } from "./friendly-error-internal";

/**
 * The result of classifying a raw error string for display.
 */
export interface FriendlyError {
  /** Human-readable message safe to show to the user. */
  message: string;
}

// Every "invalid <...> request" validation string shares one friendly message.
const VALIDATION_REQUEST = /^invalid .+ request$/;
const RATE_LIMIT = /(?:\b429\b|rate[- ]?limit|too many requests)/i;
const RAW_RPC = /(?:^\s*RPC:|\bstarknet_[a-zA-Z0-9_]+\b[\s\S]*\bparams\b|\bwith params\s*\{)/i;
const RAW_RPC_RESPONSE =
  /(?:^\s*(?:20|24|41|55):|\baccount validation failed\b|\bblock not found(?:: undefined)?\b|\bcontract not found(?:: undefined)?\b|\bresource bounds? (?:were )?not satisfied\b|\btransaction execution error\b)/i;
const RAW_HTTP = /(?:\bHTTP\s+[45]\d\d\b|\bresponse body\b|\brequest rejected\s*[:{[])/i;
// A diagnostic no reader was meant to see. Curated copy starts with a capital
// or a digit; the raw strings the background throws start lowercase.
const DEVELOPER_VOICE = /^[a-z]/;
// The STRK20 lanes suffix their reason to one shared head ("strk20 services
// unavailable: no RPC endpoint is configured"); the head is what the reader
// can act on, the suffix is for the copy control.
const STRK20_UNAVAILABLE = /^strk20 services unavailable\b/;

const rawServiceDiagnostic = (value: string): boolean =>
  value.length > 240 ||
  /[\r\n]/.test(value) ||
  RAW_HTTP.test(value) ||
  /^\s*[[{][\s\S]*[\]}]\s*$/.test(value);

/**
 * Classifies a raw error string into user-facing copy.
 *
 * An unmapped string is shown as-is only when it already reads as a sentence
 * and is not the wallet's own plumbing. A lowercase diagnostic, or a
 * capitalised one from an internal family (./friendly-error-internal), is
 * replaced with `context` — the sentence the calling screen uses for its own
 * failure, such as "Couldn't add that account. Try again." — or the generic
 * fallback, so a string nobody wrote for a reader cannot reach one.
 *
 * Two kinds of message are let through on purpose. A Ledger rejection code is
 * shown with the device catalog's own sentence. A security or cryptographic
 * fact (a failed signing, key, hash, proof, chain-id, or pinned-class check)
 * is never collapsed: the reader is told what failed.
 *
 * This is a backstop, not a substitute for the table: it makes a new
 * diagnostic read as "Something went wrong" rather than as source code, which
 * is better but still not an answer.
 */
export const friendlyError = (raw: string, context?: string): FriendlyError => {
  const fallback = context ?? UNEXPECTED_FALLBACK;
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { message: fallback };
  }

  const normalized = trimmed.toLowerCase();
  const mapped = ERROR_COPY.get(normalized);
  if (mapped) {
    return { message: mapped };
  }

  if (isLedgerRejectionCode(trimmed)) {
    return { message: ledgerMessage(trimmed) };
  }

  if (VALIDATION_REQUEST.test(normalized)) {
    return { message: GENERIC_VALIDATION };
  }

  if (STRK20_UNAVAILABLE.test(normalized)) {
    return { message: ERROR_COPY.get("strk20 services unavailable") ?? fallback };
  }

  // A node's own answer is classified before the transport markers: an RPC
  // rejection whose text mentions a timeout ("execution timed out") came back
  // from the node, so it is not a connectivity failure (mc-wallet issue 476).
  if (RATE_LIMIT.test(trimmed)) {
    return { message: RATE_LIMITED };
  }

  if (RAW_RPC.test(trimmed) || RAW_RPC_RESPONSE.test(trimmed)) {
    return { message: RPC_REJECTED };
  }

  const networkError = friendlyNetworkError(trimmed);
  if (networkError) {
    return { message: networkError };
  }

  if (rawServiceDiagnostic(trimmed)) {
    return { message: SERVICE_REJECTED };
  }

  // A lowercase diagnostic that names a failed check keeps its words: the
  // fact outranks the voice.
  const lowercaseNoise =
    DEVELOPER_VOICE.test(trimmed) && !FACT_TERMS.test(trimmed) && !FACT_KEPT.has(normalized);
  if (lowercaseNoise || isInternalDiagnostic(trimmed)) {
    return { message: fallback };
  }
  return { message: trimmed };
};
