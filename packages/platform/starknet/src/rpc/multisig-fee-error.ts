/** Actionable classification for expired Argent multisig fee-price bounds. */

import { WalletError } from "@mc-wallet/core/errors";
import { RpcError } from "starknet";

/**
 * Stable message shown when a frozen intent can no longer enter the mempool.
 */
export const ARGENT_MULTISIG_FEE_EXPIRED_MESSAGE = "Not submitted — network fees changed.";

/**
 * Determinate rejection: the node did not accept the underpriced transaction.
 */
export class ArgentMultisigFeeExpiredError extends WalletError {
  /** Complete provider diagnostic retained for user-initiated copying. */
  public readonly details: string;

  public constructor(details: string) {
    super(ARGENT_MULTISIG_FEE_EXPIRED_MESSAGE);
    this.name = "ArgentMultisigFeeExpiredError";
    this.details = details;
  }
}

const RESOURCE_PRICE_FLOOR =
  /max\s+(?:l1\s*data|l1|l2)\s*gas\s+price.*lower\s+than\s+the\s+actual\s+gas\s+price/i;

/**
 * Checks a provider diagnostic for an expired signed resource-price ceiling.
 */
export const isArgentMultisigFeeExpiredMessage = (message: string): boolean =>
  RESOURCE_PRICE_FLOOR.test(message);

/**
 * Converts only Starknet's resource-price-floor rejection into a safe error.
 */
export const argentMultisigFeeExpiredError = (
  error: unknown,
): ArgentMultisigFeeExpiredError | null => {
  if (!(error instanceof Error)) return null;
  const typedMatch =
    error instanceof RpcError &&
    error.isType("VALIDATION_FAILURE") &&
    isArgentMultisigFeeExpiredMessage(error.baseError.data);
  return typedMatch || isArgentMultisigFeeExpiredMessage(error.message)
    ? new ArgentMultisigFeeExpiredError(error.message)
    : null;
};
