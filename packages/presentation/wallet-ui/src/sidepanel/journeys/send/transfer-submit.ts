/**
 * Route dispatch for a composed send: which preparation a route needs, and what
 * the review looks like once it lands.
 *
 * All three pool routes share one shape — prepare, review, then execute the
 * prepared batch by id — while a public transfer keeps the estimate-and-submit
 * path. Keeping the mapping here means the Send binding branches once on the
 * route rather than once per privacy feature.
 */

import type { SendRoute } from "@mc-wallet/transactions/send-routes";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { PrivacyPreparation } from "../privacy/privacy-runtime";
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
): Promise<PrivacyPreparation> | null => {
  if (route.id === "public-private") {
    // Every route passes the composed recipient through, deposits included. The
    // recipient being a required argument rather than an optional extra is what
    // makes the old failure structurally unreachable: a deposit that ignored it
    // shielded to the sender while every screen reported a payment to a friend.
    return wallet.preparePrivacyDeposit(fields.tokenId, fields.amount, fields.recipient);
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
