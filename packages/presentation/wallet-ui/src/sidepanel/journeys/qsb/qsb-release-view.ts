/**
 * The release review's rows for one QSB withdrawal, built from a validated
 * `QsbWithdrawalReview`: what the BIP requires before any secret leaves. Pure:
 * every dynamic value is escaped by the shared receipt renderer. The screen
 * shell, with its deposit eyebrow, warning and password field, lives beside
 * its binding in ./qsb-release-ui.
 */
import { receiptRows } from "@bramble/ui-kit/content";
import type { QsbWithdrawalReview } from "@bramble/wallet-model/qsb-withdrawals";
import { btcText } from "./qsb-vault-model";
import { QSB_KEYS_RELEASED } from "./qsb-withdrawal-model";

/**
 * The review's rows for a validated review: what the BIP requires before
 * release — the network and the one-time keys it releases, then both inputs
 * the transaction spends (the deposit and the helper from the QSB vault's
 * balance, which Bramble signs), the network fee, what the full destination
 * receives, and the size. The same sum, in the same order, as the Withdraw
 * summary the terms were accepted on.
 */
export const qsbReleaseReviewRows = (review: QsbWithdrawalReview): string =>
  receiptRows([
    { label: "Network", value: "Bitcoin mainnet" },
    { label: "Releases", value: QSB_KEYS_RELEASED },
    { label: "Deposit", value: btcText(review.fundingSat), valueStyle: "code" },
    { label: "From your balance", value: `+ ${btcText(review.helperSat)}`, valueStyle: "code" },
    { label: "Network fee", value: `− ${btcText(review.feeSat)}`, valueStyle: "code" },
    { label: "You receive", value: btcText(review.outputSat), valueStyle: "code" },
    { label: "To", value: review.destination, valueStyle: "code" },
    { label: "Size", value: `${review.vsize} vB`, valueStyle: "code" },
  ]);
