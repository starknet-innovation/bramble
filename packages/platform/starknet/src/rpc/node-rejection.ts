/**
 * A node's own refusal, separated from the request dump starknet.js wraps
 * around it.
 *
 * Trust boundary: `baseError` and `Error.message` are untrusted node text.
 * This keeps one short sentence and drops the RPC params, so a calldata or
 * gas refusal can be shown and returned to a dapp without the request body.
 * A wallet-written {@link WalletError} is left alone: those messages are
 * already the sentence the caller chose. Failure behaviour: anything that is
 * not one short reason returns null, and the caller keeps its generic reply.
 */

import { WalletError } from "@bramble/core/errors";
import { isRecord } from "@bramble/core/json";

const PREFIX = "The network rejected this transaction: ";

/**
 * Longest user-facing sentence {@link networkRejectionMessage} returns.
 * Matches the approval text bound so a node reason cannot blow the card.
 */
export const NETWORK_REJECTION_MESSAGE_MAX = 300;

// One period may be added when the node omitted it.
const REASON_MAX = NETWORK_REJECTION_MESSAGE_MAX - PREFIX.length - 1;

// The node's own limit and fee sentences. Execution and validation errors are
// omitted: their detail is written by the contract the dapp called.
const NODE_SIDE_REASON =
  /calldata length exceeded|exceeded the maximum data length|max data length|l2 gas|resource bounds|insufficient (?:account )?balance|invalid transaction nonce|fee below minimum|replacement transaction underpriced/i;

const readableReason = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length === 0 || text.length > REASON_MAX) return null;
  if (
    /^RPC:/i.test(text) ||
    /with params/i.test(text) ||
    /https?:\/\//i.test(text) ||
    !NODE_SIDE_REASON.test(text)
  ) {
    return null;
  }
  return text;
};

const reasonFromBase = (error: object): string | null => {
  const base: unknown = Reflect.get(error, "baseError");
  if (!isRecord(base)) return null;
  // `data` is contract-controlled (revert_error and friends). Never shown.
  return readableReason(base["message"]);
};

/**
 * The node's short limit or fee refusal, or null otherwise. Only
 * `baseError.message` is read, and only when it is a node-side limit (calldata,
 * gas, nonce, balance, or minimum fee). Contract revert text is ignored, so it
 * cannot appear under "The network rejected this transaction". A wallet-written
 * {@link WalletError} is left alone. Does not copy Starknet's calldata or gas caps.
 */
export const nodeRejectionReason = (error: unknown): string | null => {
  if (error instanceof WalletError || typeof error !== "object" || error === null) return null;
  return reasonFromBase(error);
};

/**
 * The side-panel and dapp sentence for {@link nodeRejectionReason}. The
 * reason is the node's words; the head only names that the network refused.
 */
export const networkRejectionMessage = (reason: string): string => {
  const text = reason.trim();
  const ended = /[.!?]$/.test(text) ? text : `${text}.`;
  return `${PREFIX}${ended}`;
};
