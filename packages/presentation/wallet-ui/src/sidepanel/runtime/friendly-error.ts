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
import {
  ERROR_COPY,
  GENERIC_VALIDATION,
  RATE_LIMITED,
  RPC_REJECTED,
  SERVICE_REJECTED,
  UNEXPECTED_FALLBACK,
} from "./friendly-error-copy";

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
const rawServiceDiagnostic = (value: string): boolean =>
  value.length > 240 ||
  /[\r\n]/.test(value) ||
  RAW_HTTP.test(value) ||
  /^\s*[[{][\s\S]*[\]}]\s*$/.test(value);

/**
 * Classifies a raw error string into user-facing copy.
 *
 * An unrecognised string is still shown as-is. Refusing every lowercase
 * diagnostic would be the better guard, but the Argent multisig vocabulary is
 * not translated yet and several of its strings tell a signer something they
 * need; that guard lands with the multisig copy pass, once nothing is left to
 * lose by it.
 */
export const friendlyError = (raw: string): FriendlyError => {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { message: UNEXPECTED_FALLBACK };
  }

  const normalized = trimmed.toLowerCase();
  const mapped = ERROR_COPY.get(normalized);
  if (mapped) {
    return { message: mapped };
  }

  if (VALIDATION_REQUEST.test(normalized)) {
    return { message: GENERIC_VALIDATION };
  }

  const networkError = friendlyNetworkError(trimmed);
  if (networkError) {
    return { message: networkError };
  }

  if (RATE_LIMIT.test(trimmed)) {
    return { message: RATE_LIMITED };
  }

  if (RAW_RPC.test(trimmed) || RAW_RPC_RESPONSE.test(trimmed)) {
    return { message: RPC_REJECTED };
  }

  if (rawServiceDiagnostic(trimmed)) {
    return { message: SERVICE_REJECTED };
  }

  return { message: trimmed };
};
