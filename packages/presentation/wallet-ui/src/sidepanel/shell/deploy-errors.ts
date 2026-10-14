/**
 * What the account deploy screen says when a quote or a deployment fails.
 *
 * The screen's status line and Cost box have no copy control, so they take the
 * reader-facing sentence (`errorLine`), never the raw diagnostic: a node
 * rejection carries the whole `starknet_addDeployAccountTransaction` request,
 * which is what the status line printed (mc-wallet issue 662). One rejection
 * earns a sentence of its own, because the reader can act on it: the account
 * cannot pay the deployment fee.
 */
import { isOutcomeUnknown } from "../runtime/runtime-errors";
import { errorDetails, errorLine, errorMessage } from "../shared/dom";

/**
 * A node or gate refusal that means the paying account cannot cover the fee:
 * the node's "exceed balance" validation failure, an insufficient-balance
 * refusal, or the multisig gate's own "needs STRK" check. Shared with the
 * multisig deploy so the two deploy screens recognise the same rejections.
 */
export const FEE_FUNDING_SHORTFALL = /exceed balance|insufficient[^\n]*balance|address needs STRK/i;

/** The deploy screen's line when the account holds too little STRK for the fee. */
export const DEPLOY_NEEDS_STRK = "Add STRK to this account to deploy it.";

/**
 * The sentence the deploy screen shows for `error`: the funding line for a
 * fee-funding refusal, otherwise the shared translation. A write whose outcome
 * is unknown never reads as the funding line, which would imply nothing was
 * sent; it keeps its "check Activity" sentence.
 */
export const deployErrorLine = (error: unknown, fallback: string): string =>
  fundingShortfall(error, fallback) ? DEPLOY_NEEDS_STRK : errorLine(error, fallback);

/**
 * What the deploy screen hands `showToast`: the funding line as written, or
 * the raw diagnostic, which the toast translates itself and keeps behind its
 * copy control. Passing the translated line instead would translate it twice.
 */
export const deployToastText = (error: unknown, fallback: string): string =>
  fundingShortfall(error, fallback) ? DEPLOY_NEEDS_STRK : errorMessage(error, fallback);

const fundingShortfall = (error: unknown, fallback: string): boolean =>
  !isOutcomeUnknown(error) && FEE_FUNDING_SHORTFALL.test(errorDetails(error, fallback));
