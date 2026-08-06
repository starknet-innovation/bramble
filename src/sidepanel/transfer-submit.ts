/**
 * Route dispatch for a composed send: which preparation a route needs, and what
 * the review looks like once it lands.
 *
 * All three pool routes share one shape — prepare, review, then execute the
 * prepared batch by id — while a public transfer keeps the estimate-and-submit
 * path. Keeping the mapping here means the Send binding branches once on the
 * route rather than once per privacy feature.
 */

import { sameFelt } from "../starknet/networks";
import type { SendRoute } from "../starknet/send-routes";
import type { PrivacyPreparation } from "./privacy-runtime";
import type { SidepanelWallet } from "./runtime";
import type { TransferFields } from "./transfer-model";

/**
 * Review shape the Send screen renders. Structurally the public review, so the
 * pool routes synthesize one from their preparation.
 */
export type TransferReview = Awaited<ReturnType<SidepanelWallet["reviewTransfer"]>>;

/**
 * Starts the preparation a pool route needs, or `null` for a public transfer,
 * which reviews through the fee estimator instead.
 */
export const preparationFor = (
  route: SendRoute,
  fields: TransferFields,
  wallet: SidepanelWallet,
  senderAddress: string,
): Promise<PrivacyPreparation> | null => {
  if (route.id === "public-private") {
    // A v1 deposit credits the depositor and takes no recipient, so a recipient
    // other than the account itself cannot be honoured. Refusing here rather
    // than dropping it is the point: this route once shielded to the sender
    // while every screen reported a payment to the chosen recipient. The route
    // resolver refuses this too; this is the backstop that makes the silent
    // misdirection unreachable rather than merely gated.
    if (!sameFelt(fields.recipient, senderAddress)) {
      return Promise.reject(
        new Error("Shielding credits your own private balance; choose your own account"),
      );
    }
    return wallet.preparePrivacyDeposit(fields.tokenId, fields.amount);
  }
  if (route.id === "private-private") {
    return wallet.preparePrivacyTransfer(fields.tokenId, fields.recipient, fields.amount);
  }
  if (route.id === "private-public") {
    return wallet.preparePrivacyWithdraw(fields.tokenId, fields.recipient, fields.amount);
  }
  return null;
};

/**
 * The copy shown when a route's preparation fails, named per route so the toast
 * says which leg of the move did not happen.
 */
export const preparationFailure = (route: SendRoute): string => {
  if (route.id === "public-private") {
    return "Shielding preparation failed";
  }
  if (route.id === "private-public") {
    return "Unshielding preparation failed";
  }
  return "Private send preparation failed";
};

/**
 * Builds the review a pool route shows from its preparation.
 *
 * `feeAffordability` is `"unknown"` rather than a verdict: a relayed route pays
 * the network fee through the relay and recovers the pool charge from the
 * private balance, and a deposit's own fee lands in the estimate the account
 * route already produces, so the public STRK guard has nothing to say. `unknown`
 * renders no notice.
 */
export const preparedReview = (preparation: PrivacyPreparation): TransferReview =>
  ({
    fee: null,
    feeAffordability: "unknown",
    feeEstimateFailed: false,
    flags: [],
    requiresDeployment: false,
    summaries: [...preparation.summaries],
  }) as TransferReview;
