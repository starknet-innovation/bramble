/**
 * The release review's rows for one QSB withdrawal, built from a validated
 * `QsbWithdrawalReview`: what the BIP requires before any secret leaves. Pure:
 * every dynamic value is escaped by the shared receipt renderer. The screen
 * shell, with its warning and password field, lives beside its binding in
 * ./qsb-release-ui.
 */
import { receiptRows } from "@bramble/ui-kit/content";
import type { QsbWithdrawalReview } from "@bramble/wallet-model/qsb-withdrawals";
import { btcText, qsbDepositTitle } from "./qsb-vault-model";
import { QSB_KEYS_RELEASED } from "./qsb-withdrawal-model";

/**
 * The review's rows for a validated review of `accountId`'s deposit: what
 * the BIP requires before release — the network, which deposit, the one-time
 * keys it releases, the full destination, what that receives, and the
 * network fee and size.
 */
export const qsbReleaseReviewRows = (accountId: string, review: QsbWithdrawalReview): string =>
  receiptRows([
    { label: "Network", value: "Bitcoin mainnet" },
    { label: "Deposit", value: qsbDepositTitle(accountId, review.v) },
    { label: "Releases", value: QSB_KEYS_RELEASED },
    { label: "To", value: review.destination, valueStyle: "code" },
    { label: "You receive", value: btcText(review.outputSat), valueStyle: "code" },
    { label: "Network fee", value: btcText(review.feeSat), valueStyle: "code" },
    { label: "Size", value: `${review.vsize} vB`, valueStyle: "code" },
  ]);
