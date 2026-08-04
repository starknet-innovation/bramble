/**
 * Turns a Starknet node's semantic RPC rejection into a wallet error a user can
 * act on, reading STRUCTURED fields only.
 *
 * Trust boundary: the input is the `baseError` object starknet.js attaches to a
 * rejected request — untrusted, node-controlled data. The enclosing
 * `Error.message` starknet.js builds is deliberately NOT read: it embeds the
 * full JSON request params, which on the privacy path carry proof blobs and
 * note calldata. Only `code` (a number) and the `revert_reason` /
 * `execution_error` strings under `data` are consulted, and every string is
 * sanitized (whitespace collapsed, long hex runs elided, non-printable bytes
 * dropped, length capped) before it reaches a message.
 *
 * Failure behaviour: fail closed. Any shape that is not a record with a numeric
 * `code` yields `null`, leaving the caller's original error — and therefore the
 * transport/semantic split — untouched. A recognised failure with no usable
 * reason still produces an error naming the code, never a partial guess.
 */
import { WalletError } from "./errors";
import { isRecord } from "./json";

/**
 * Opening words of every wallet error whose text embeds a node-supplied reason.
 *
 * Single-sourced because it is a contract between two layers: the mapper below
 * writes it, and the dapp error boundary (`errorForMessage` in `./rpc-errors`)
 * keys off it to redact unconditionally. Node-supplied reason text is arbitrary
 * chain data and may contain any keyword that boundary pattern-matches on, so
 * such errors must never be classified — only the extension's own UI sees them.
 */
export const RPC_FAILURE_PREFIX = "The network could not execute this transaction";

// Node reasons are one sentence in practice; anything longer is a payload echo
// rather than an explanation, so it is cut rather than surfaced whole.
const MAX_REASON_LENGTH = 200;
// Addresses, class hashes, selectors and proof limbs all render as long hex
// runs. Felt-sized values and above are elided; short hex (a code, an index)
// survives because it is the part a reader can act on.
const HEX_RUN = /0x[0-9a-fA-F]{12,}/g;
// Everything outside printable ASCII is dropped rather than escaped: a reason
// is explanatory text, and anything else is a shape we do not understand.
const NON_PRINTABLE = /[^ -~]/g;
// CONTRACT_EXECUTION_ERROR nests one frame per contract call. Bounded so a
// malformed self-referential payload cannot spin.
const MAX_EXECUTION_FRAMES = 8;
// Bounds the scan itself, before any pattern runs: a broken or hostile node can
// return a reason of any size, and the wallet should not walk megabytes of it
// only to keep 200 characters. The slice is generous enough that collapsing
// whitespace inside it can still fill the cap.
const MAX_SCANNED_LENGTH = MAX_REASON_LENGTH * 4;

const sanitizeReason = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value
    .slice(0, MAX_SCANNED_LENGTH)
    .replace(HEX_RUN, "0x...")
    .replace(NON_PRINTABLE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") {
    return null;
  }
  return cleaned.length > MAX_REASON_LENGTH
    ? `${cleaned.slice(0, MAX_REASON_LENGTH).trimEnd()}...`
    : cleaned;
};

// Walks the recursive CONTRACT_EXECUTION_ERROR shape (`{ ..., error }` frames
// wrapping an innermost string) down to the text the contract actually raised.
// The wrapper frames only name addresses, class hashes and selectors, which the
// sanitizer elides anyway.
const innermostExecutionError = (value: unknown): unknown => {
  let current = value;
  for (let frame = 0; frame < MAX_EXECUTION_FRAMES; frame += 1) {
    if (!isRecord(current)) {
      return current;
    }
    current = current["error"];
  }
  return current;
};

const reasonFromData = (data: unknown): string | null => {
  if (!isRecord(data)) {
    return sanitizeReason(data);
  }
  return (
    sanitizeReason(data["revert_reason"]) ??
    sanitizeReason(innermostExecutionError(data["execution_error"]))
  );
};

/**
 * Maps a starknet.js `baseError` payload to the wallet error the extension UI
 * shows, or `null` when the payload is not a semantic node rejection.
 *
 * `null` is the fail-closed answer: it means the caller must rethrow its
 * original error so transport ambiguity keeps producing the existing
 * "submission status is unknown" wording rather than a reason the node never
 * gave. Callers pass the value straight from the error object; a non-record, or
 * a record without a numeric `code`, is rejected here rather than at each site.
 */
export const rpcFailureError = (baseError: unknown): WalletError | null => {
  if (!isRecord(baseError) || typeof baseError["code"] !== "number") {
    return null;
  }
  const code = baseError["code"];
  const reason = reasonFromData(baseError["data"]);
  return new WalletError(
    reason === null
      ? `${RPC_FAILURE_PREFIX} (RPC error ${code}).`
      : `${RPC_FAILURE_PREFIX} (RPC error ${code}): ${reason}`,
  );
};
