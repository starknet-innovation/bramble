/**
 * Small error helper for fail-closed domain checks.
 */
import { isRecord } from "./json";

/**
 * Curated domain error safe to surface across the wallet's dapp boundary.
 */
export class WalletError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}

/**
 * Throws a wallet error when an internal invariant is violated.
 */
export const invariant = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new WalletError(message);
  }
};

/**
 * Extracts a stable, user-facing message from a caught error. A `WalletError`
 * carries a curated message safe to surface across the dapp boundary (a device
 * rejection, a locked wallet); anything else collapses to the caller's generic
 * fallback so internal detail never leaks. Used by the held-approval executors
 * to turn a thrown sign/submit failure into a returned `{ error }` response.
 */
export const walletErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof WalletError ? error.message : fallback;

/** Longest diagnostic kept; a node can reject with a very large payload. */
const MAX_DETAIL_LENGTH = 600;
const RPC_REASON_KEYS = ["execution_error", "revert_error"] as const;

// starknet.js puts an RpcError's full request params in `message`, while the
// response that explains a rejection is kept separately in `baseError`. Reading
// the former would put calldata into a wallet diagnostic and hide the reason.
const rpcReason = (data: unknown): string => {
  if (typeof data === "string") {
    return data;
  }
  if (!isRecord(data)) {
    return "";
  }
  for (const key of RPC_REASON_KEYS) {
    const value = data[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
};

const rpcDetail = (baseError: unknown): string => {
  if (!isRecord(baseError)) {
    return "";
  }
  const code = typeof baseError["code"] === "number" ? String(baseError["code"]) : "";
  const message = typeof baseError["message"] === "string" ? baseError["message"] : "";
  return [code, message, rpcReason(baseError["data"])].filter((part) => part !== "").join(" ");
};

const detailText = (error: unknown): string => {
  const baseError = (error as { readonly baseError?: unknown } | null | undefined)?.baseError;
  // An RPC envelope means `error.message` is a request dump, even if the
  // envelope itself is malformed. Do not fall back to that request body.
  if (baseError !== undefined) {
    return rpcDetail(baseError);
  }
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
};

/**
 * Extracts a caught error's diagnostic text for the **wallet's own surfaces
 * only** — the panel's status line and its copy-for-a-bug-report control. This
 * is the counterpart to {@link walletErrorMessage}: that function deliberately
 * collapses an uncurated error to a generic message so internal detail never
 * crosses the dapp boundary, which also threw away the one thing a user needs
 * to understand a rejected transaction (the node's reason).
 *
 * Callers must keep the two apart: send {@link walletErrorMessage} to the page
 * and this only to the extension's own UI. Never persist or log the result.
 *
 * Returns `null` when there is nothing to add — no message, or text identical to
 * the curated `summary` — so callers can omit the field rather than repeat
 * themselves. Output is trimmed and truncated to a bounded length.
 */
export const errorDetail = (error: unknown, summary: string): string | null => {
  const trimmed = detailText(error).trim();
  if (trimmed === "" || trimmed === summary) {
    return null;
  }
  return trimmed.length > MAX_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_DETAIL_LENGTH)}…` : trimmed;
};

/**
 * Checks a value against the exact shape {@link errorDetail} produces: a
 * non-empty string no longer than the truncation bound plus the ellipsis that
 * truncation appends.
 *
 * Extension pages validate a background-supplied diagnostic with this rather
 * than restating the bound, so the producer's limit and every consumer's check
 * cannot drift apart. A value failing this check did not come from
 * `errorDetail` and must not be rendered.
 */
export const isErrorDetail = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_DETAIL_LENGTH + 1;
