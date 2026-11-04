/**
 * Replies of the five QSB vault messages, split from ./runtime-types by the
 * size budget. Every one is public data in the shared contract's shapes
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

/**
 * `wallet.qsbVaults` (address, funds or null, vaults), `wallet.createQsbVault`
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
