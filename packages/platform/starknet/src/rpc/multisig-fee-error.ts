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

/**
 * Checks a provider diagnostic for an expired signed resource-price ceiling.
 */
export const isArgentMultisigFeeExpiredMessage = (message: string): boolean => {
  const normalized = message.toLowerCase().replace(/\s/g, "");
  return (
    normalized.includes("lowerthantheactualgasprice") &&
    ["maxl1gasprice", "maxl1datagasprice", "maxl2gasprice"].some((label) =>
      normalized.includes(label),
    )
  );
};

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
