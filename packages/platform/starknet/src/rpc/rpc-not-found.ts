/**
 * Classifiers for the three "the node has no record of it" answers.
 *
 * Grouped because they share one shape — a curated message match plus the
 * JSON-RPC code — and because their callers differ in kind: an absent contract
 * distinguishes an undeployed account from a broken read, an absent transaction
 * is ordinary pre-confirmation noise, and an absent BLOCK is routine skew behind
 * a load-balanced endpoint rather than a chain-state failure.
 */
import { isRecord } from "@mc-wallet/core/json";

/**
 * Checks whether an RPC failure means the queried contract is not deployed.
 */
export const isContractNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/contract not found/i.test(error.message)) {
    return true;
  }
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError["code"] === 20;
};

/**
 * Checks whether an RPC failure means the node has no record of the queried
 * transaction hash (`TXN_HASH_NOT_FOUND`, JSON-RPC error 29).
 *
 * This is a semantic answer, not a transport failure: the node replied and said
 * it does not know the hash. Callers must still treat a single not-found as
 * noise — a hash can legitimately be unknown to one node moments after
 * broadcast, and a pre-confirmed transaction can disappear when its block
 * proposal fails to commit. Use {@link isTransportRpcError} to keep "we could
 * not ask" apart from "the node says it is gone".
 */
export const isTransactionNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/transaction hash not found/i.test(error.message)) {
    return true;
  }
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError["code"] === 29;
};

/**
 * Checks whether an RPC failure means the queried block is unknown to the node
 * that answered (JSON-RPC error 24).
 *
 * On a load-balanced endpoint this is routine rather than exceptional: one
 * request reads the head from a node, the next is routed to a sibling a block
 * behind, and a read pinned to that hash finds nothing. Reproduced against the
 * wallet's own mainnet endpoint at roughly one attempt in eight. Callers that
 * pin a block for read consistency use this to re-pin and retry rather than
 * reporting a chain-state failure the chain never had.
 */
export const isBlockNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (/block not found/i.test(error.message)) {
    return true;
  }
  const baseError = (error as { readonly baseError?: unknown }).baseError;
  return isRecord(baseError) && baseError["code"] === 24;
};
