/**
 * Stable error mapping for untrusted official-SDK and service failures.
 */

import { WalletError } from "../../shared/errors";
import { isRecord } from "../../shared/json";
import { friendlyNetworkError } from "../../shared/network-error";
import {
  STRK20_INSUFFICIENT_BALANCE,
  STRK20_NOT_REGISTERED,
  STRK20_PRIVACY_LEAK,
  STRK20_SERVICE_UNAVAILABLE,
} from "./service";

/**
 * Sanitized pipeline stage a private-transaction failure was observed in. Only
 * these fixed labels are ever surfaced, so a stage can attribute a failure
 * without describing what was being proved or submitted.
 */
export type Strk20FailureStage =
  | "approval"
  | "confirmation"
  | "discovery"
  | "proving"
  | "registration-preparation"
  | "submission";

/**
 * Sanitized failure category. A fixed vocabulary derived from the structured
 * RPC/SDK failure, never from note, proof, or key material.
 */
export type Strk20ErrorCategory =
  | "execution-reverted"
  | "insufficient-fee"
  | "invalid-nonce"
  | "proof-rejected"
  | "service-unavailable"
  | "transport"
  | "validation-failed";

// Longest sanitized revert detail surfaced to the user. A Starknet revert reason
// is short; a longer string is far more likely to be an echoed request body.
const DETAIL_LIMIT = 800;

const BASE_MARKERS: readonly (readonly [RegExp, string])[] = [
  [/not registered|registration|viewing key.*not set/i, STRK20_NOT_REGISTERED],
  [/insufficient|not enough (?:private )?(?:funds|balance|notes)/i, STRK20_INSUFFICIENT_BALANCE],
  [/USER_LINKAGE|privacy leak/i, STRK20_PRIVACY_LEAK],
];

const CATEGORY_MARKERS: readonly (readonly [RegExp, Strk20ErrorCategory])[] = [
  [/invalid transaction nonce|nonce mismatch|wrong nonce/i, "invalid-nonce"],
  [/validate_failure|validation failed|validate failed/i, "validation-failed"],
  [/max fee|fee token|exceed balance|fee transfer/i, "insufficient-fee"],
  [/proof|base_block|proving/i, "proof-rejected"],
  [/revert|execution (?:error|failed)|contract error|entry ?point/i, "execution-reverted"],
];

const REVERT_KEYS = ["revert_error", "execution_error"] as const;

// Structured revert text carried by an RPC error's `data`. Only plain strings
// are read; a nested trace object contributes nothing rather than being walked.
const revertText = (data: unknown): string => {
  if (typeof data === "string") {
    return data;
  }
  if (!isRecord(data)) {
    return "";
  }
  for (const key of REVERT_KEYS) {
    const value = data[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
};

// starknet.js builds an RpcError's `message` by embedding the full JSON request
// params, which on a privacy submission contain the proof blob and the
// note-derived calldata. So the structured `baseError` is read instead, and the
// error's own message is only used when there is no RPC envelope at all.
const failureText = (error: unknown): string => {
  const baseError = (error as { readonly baseError?: unknown } | null | undefined)?.baseError;
  if (baseError === undefined) {
    return error instanceof Error ? error.message : "";
  }
  // An RPC envelope is present, so the error's own message is off limits even if
  // the envelope itself turns out to be unreadable: contributing no detail is
  // always preferable to echoing a request body back to the user.
  if (!isRecord(baseError)) {
    return "";
  }
  const code = typeof baseError["code"] === "number" ? String(baseError["code"]) : "";
  const message = typeof baseError["message"] === "string" ? baseError["message"] : "";
  return [code, message, revertText(baseError["data"])].filter((part) => part !== "").join(" ");
};

/**
 * Reduces failure text to something safe to display: service endpoints, felt
 * and hex blobs (note ids, proof facts, commitments, keys) and long opaque
 * tokens (base64 proof data) are replaced, then the result is bounded.
 */
export const sanitizeStrk20Detail = (text: string): string =>
  text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[endpoint]")
    .replace(/0x[0-9a-f]{8,}/gi, "[value]")
    .replace(/[A-Za-z0-9+/=_-]{28,}/g, "[value]")
    .replace(/[^ -~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DETAIL_LIMIT);

const markerFor = <T>(text: string, markers: readonly (readonly [RegExp, T])[]): T | undefined => {
  for (const [pattern, value] of markers) {
    if (pattern.test(text)) {
      return value;
    }
  }
  return undefined;
};

/**
 * Collapses protocol-specific failures into the Wallet API's reviewed error
 * surface without exposing service internals to sites or UI state.
 */
export const mapStrk20ProtocolError = (error: unknown): never => {
  if (error instanceof WalletError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : "";
  throw new WalletError(markerFor(message, BASE_MARKERS) ?? STRK20_SERVICE_UNAVAILABLE);
};

/**
 * Maps a failure from a previously unmapped region of the private-transaction
 * pipeline, keeping the reviewed base message but appending the sanitized stage,
 * error category, and — critically for an on-chain rejection — the Starknet
 * revert reason, which is otherwise discarded at this boundary. Note material,
 * proofs, authorizing secrets, vault data, and service endpoints never survive
 * `sanitizeStrk20Detail`.
 */
export const mapStrk20StageError = (stage: Strk20FailureStage, error: unknown): never => {
  if (error instanceof WalletError) {
    throw error;
  }
  const text = failureText(error);
  const detail = sanitizeStrk20Detail(text);
  const category: Strk20ErrorCategory =
    markerFor(text, CATEGORY_MARKERS) ??
    (friendlyNetworkError(text) ? "transport" : "service-unavailable");
  const base = markerFor(text, BASE_MARKERS) ?? STRK20_SERVICE_UNAVAILABLE;
  const label = `${base} (${stage}/${category})`;
  throw new WalletError(detail === "" ? label : `${label}: ${detail}`);
};
