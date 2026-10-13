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

import { friendlyNetworkError, NETWORK_ERROR_MESSAGE } from "@bramble/core/network-error";
import { isLedgerRejectionCode, ledgerMessage } from "@bramble/ledger-protocol/errors";
import {
  ERROR_COPY,
  GENERIC_VALIDATION,
  RATE_LIMITED,
  RPC_REJECTED,
  SERVICE_REJECTED,
  UNEXPECTED_FALLBACK,
} from "./friendly-error-copy";
import { FACT_TERMS, isReviewedPlumbing } from "./friendly-error-internal";
import { PRIVACY_LEAK } from "./friendly-error-shared";

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
// STRK20 messages share one head; only the reasons below mean "the private
// services are down or not configured", which the reader can only wait out.
// Every other STRK20 message — an unknown submission status, a revert, a
// rejected proof, a failed validation, a nonce, a fee ceiling — is a funds or
// security fact and is shown as written (issue 652 review, F1).
const STRK20_SERVICE_DOWN =
  /^strk20 services unavailable(?:: (?:no viewing-key provider is wired|no privacy routing is configured for this network|the configured pool address is not a valid felt|no privacy runtime is wired in this build|no rpc endpoint is configured|could not read the pool fee \([^)]*\)|could not read pool registration \([^)]*\)))?$/;
const STRK20_RATE_LIMITED = "strk20 services unavailable (rate limited; retry shortly)";
// A refusal that would have linked the reader's identity to a private action.
const STRK20_PRIVACY_LEAK = /^strk20 privacy leak\b/;
const STRK20 = /^strk20\b/;

// `mapStrk20StageError`'s shape: the reviewed head, the stage and category it
// classified, and the sanitised detail (official-sdk-errors.ts).
const STRK20_STAGE = /^strk20 services unavailable \(([a-z-]+)\/([a-z-]+)\)(?:: ([\s\S]+))?$/i;
// `mapStrk20ProtocolError`'s shape: the reviewed head and the sanitised cause.
const STRK20_PROTOCOL = /^strk20 services unavailable: ([\s\S]+)$/i;
const STRK20_SERVICES_DOWN = "strk20 services unavailable";

// A reviewed sentence with the sanitised detail kept beside it, so the cause
// stays visible on a status line that has no copy control.
const withDetail = (sentence: string, detail: string | undefined): string =>
  detail ? `${sentence} (${detail})` : sentence;

/**
 * STRK20 messages share one head, "strk20 services unavailable", whatever
 * actually happened. Only a category that means rate limiting or an
 * unreachable network earns the matching reviewed sentence; the SDK's
 * catch-all category is shown as written; a revert, a
 * rejected proof, a failed validation, a nonce or a fee is a fact with no
 * reviewed sentence yet, so it is shown as written without the head, which
 * would say the services were down when the transaction was refused (errors
 * audit F5). An unknown submission status, a privacy-leak refusal, and every
 * other STRK20 message keep their own words.
 */
const strk20Message = (trimmed: string, normalized: string): string => {
  if (STRK20_PRIVACY_LEAK.test(normalized)) return PRIVACY_LEAK;
  if (normalized === STRK20_RATE_LIMITED) return RATE_LIMITED;
  const servicesDown = ERROR_COPY.get(STRK20_SERVICES_DOWN) ?? trimmed;
  if (STRK20_SERVICE_DOWN.test(normalized)) return servicesDown;
  const staged = STRK20_STAGE.exec(trimmed);
  if (staged) {
    const [, stage, category, detail] = staged;
    if (category === "rate-limited") return withDetail(RATE_LIMITED, detail);
    if (category === "transport") return withDetail(NETWORK_ERROR_MESSAGE, detail);
    // The SDK's catch-all category: it names no outage, so the reader keeps
    // the message as written (issue 652 review, F1).
    if (category === "service-unavailable") return trimmed;
    return `strk20 ${stage}/${category}${detail ? `: ${detail}` : ""}`;
  }
  const cause = STRK20_PROTOCOL.exec(trimmed)?.[1];
  if (cause && RATE_LIMIT.test(cause)) return withDetail(RATE_LIMITED, cause);
  if (cause && friendlyNetworkError(cause)) return withDetail(NETWORK_ERROR_MESSAGE, cause);
  return trimmed;
};

const rawServiceDiagnostic = (value: string): boolean =>
  value.length > 240 ||
  /[\r\n]/.test(value) ||
  RAW_HTTP.test(value) ||
  /^\s*[[{][\s\S]*[\]}]\s*$/.test(value);

/**
 * Classifies a raw error string into user-facing copy.
 *
 * The default is to show a message as written. It is replaced only when it is
 * in the copy table, is a Ledger rejection code (shown with the device
 * catalog's sentence), matches one of the transport classifiers, or is listed
 * as reviewed plumbing (./friendly-error-internal) — exact match, never a
 * prefix family. Reviewed plumbing reads as `context`, the calling screen's
 * sentence for its own failure (the Ledger picker passes "Couldn't add that
 * account. Try again."), or the generic fallback.
 *
 * STRK20 messages are classified by `strk20Message`: services down, rate
 * limited, or unreachable read as the reviewed sentence with the detail kept;
 * an unknown submission status, a revert, a rejected proof, or a privacy-leak
 * refusal is a fact the reader must keep, never framed as an outage.
 *
 * The pre-existing lowercase backstop stays, narrowed: a lowercase diagnostic
 * reads as the fallback unless it names a security, privacy, or funds fact.
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

  if (STRK20.test(normalized)) {
    return { message: strk20Message(trimmed, normalized) };
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

  if (isReviewedPlumbing(trimmed)) {
    return { message: fallback };
  }
  // The pre-existing lowercase backstop, narrowed: a lowercase diagnostic that
  // names a security, privacy, or funds fact keeps its words.
  if (DEVELOPER_VOICE.test(trimmed) && !FACT_TERMS.test(trimmed)) {
    return { message: fallback };
  }
  return { message: trimmed };
};
