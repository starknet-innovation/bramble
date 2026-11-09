/**
 * Replies of the six QSB vault messages and the five QSB withdrawal
 * messages, split from ./runtime-types by the size budget. Every one is public data in the shared contract's shapes
 * (`@bramble/wallet-model/qsb-vaults`): the owner address, its confirmed
 * funds, vault views, a deposit quote and a submission outcome. None carries
 * a phrase, a key, a journal id, a coordinator id or token, or signed bytes.
 */
import type {
  QsbDepositQuote,
  QsbOwnerFunds,
  QsbSubmission,
  QsbVaultView,
} from "@bramble/wallet-model/qsb-vaults";
import type {
  QsbWithdrawalQuote,
  QsbWithdrawalReview,
  QsbWithdrawalSubmission,
} from "@bramble/wallet-model/qsb-withdrawals";

/**
 * `wallet.qsbVaults` and `wallet.recoverQsbVaults` (address, funds or null,
 * vaults), `wallet.createQsbVault`
 * (the vault), `wallet.quoteQsbDeposit` (the quote), and
 * `wallet.depositQsbVault` and `wallet.resendQsbDeposit` (the vault and how
 * the coordinator answered).
 */
export type QsbVaultResponse =
  | {
      readonly address: string;
      readonly funds: QsbOwnerFunds | null;
      readonly ok: true;
      readonly vaults: readonly QsbVaultView[];
    }
  | { readonly ok: true; readonly quote: QsbDepositQuote }
  | { readonly ok: true; readonly submission: QsbSubmission; readonly vault: QsbVaultView }
  | { readonly ok: true; readonly vault: QsbVaultView };

/**
 * `wallet.quoteQsbWithdrawal` (the quote), `wallet.startQsbWithdrawal` (the
 * deposit, its withdrawal searching), `wallet.reviewQsbWithdrawal` (the
 * release review), and `wallet.releaseQsbWithdrawal` and
 * `wallet.resendQsbWithdrawal` (the deposit and how the coordinator took the
 * withdrawal). None carries a preimage, a job id or signed bytes.
 */
export type QsbWithdrawalResponse =
  | { readonly ok: true; readonly quote: QsbWithdrawalQuote }
  | { readonly ok: true; readonly review: QsbWithdrawalReview }
  | {
      readonly ok: true;
      readonly submission: QsbWithdrawalSubmission;
      readonly vault: QsbVaultView;
    };
