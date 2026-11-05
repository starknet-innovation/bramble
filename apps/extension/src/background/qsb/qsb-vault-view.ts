/**
 * The one projection of a QSB vault the panel may see (`QsbVaultView`):
 * its index and journal state, whether the coordinator holds its script, its
 * one deposit as public chain data, and that deposit's withdrawal
 * (./qsb-withdrawal-view). It copies no other field, so no script, root,
 * journal id, server id, job id or signed bytes reach a reply.
 *
 * A deposit is `confirmed` only once the journal records its funding; it is
 * `pending` while its signed bytes are kept here; `submitted` when the
 * coordinator records it and nothing is kept here; `none` otherwise. A reply
 * to a submission states the deposit as that submission left it.
 */
import type { QsbPublicVault } from "@bramble/qsb/vault-responses";
import type { QsbPendingDeposit } from "@bramble/vault/qsb-deposit-store";
import type { QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import type { QsbSubmission, QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type { QsbWithdrawalView } from "@bramble/wallet-model/qsb-withdrawals";
import { QSB_NO_WITHDRAWAL } from "./qsb-withdrawal-view";

/** What the coordinator says about one vault, or null when it could not be asked. */
export type QsbServerView = {
  readonly confirmations: number | null;
  readonly vault: QsbPublicVault | undefined;
} | null;

const NO_DEPOSIT: QsbVaultView["deposit"] = {
  amountSat: null,
  confirmations: null,
  status: "none",
  txid: null,
};

const depositOf = (
  record: QsbVaultRecord,
  pending: QsbPendingDeposit | undefined,
  server: QsbServerView,
): QsbVaultView["deposit"] => {
  if (record.funding) {
    return {
      amountSat: record.funding.valueSat,
      confirmations: server?.confirmations ?? null,
      status: "confirmed",
      txid: record.funding.txid,
    };
  }
  if (pending) {
    return {
      amountSat: pending.amountSat,
      confirmations: null,
      status: "pending",
      txid: pending.txid,
    };
  }
  const funding = server?.vault?.funding;
  return funding
    ? { amountSat: funding.valueSat, confirmations: null, status: "submitted", txid: funding.txid }
    : NO_DEPOSIT;
};

/**
 * The view of `record`, with its pending deposit, what the coordinator said,
 * and its withdrawal (none unless given).
 */
export const qsbVaultView = (
  record: QsbVaultRecord,
  pending: QsbPendingDeposit | undefined,
  server: QsbServerView,
  withdrawal: QsbWithdrawalView = QSB_NO_WITHDRAWAL,
): QsbVaultView => ({
  deposit: depositOf(record, pending, server),
  registered: server === null ? null : server.vault !== undefined,
  state: record.state,
  v: record.v,
  withdrawal,
});

/**
 * The view a deposit or resend answers with: the vault as `submission` left
 * it, for the transaction `txid` of `amountSat`. `submitted` is MARA having
 * it (or the journal already confirming it), `uncertain` still pending here,
 * `rejected` no deposit at all.
 */
export const qsbSubmittedView = (
  record: QsbVaultRecord,
  submission: QsbSubmission,
  deposit: { readonly amountSat: number; readonly txid: string },
): QsbVaultView => {
  const base = {
    registered: true,
    state: record.state,
    v: record.v,
    withdrawal: QSB_NO_WITHDRAWAL,
  } as const;
  if (submission === "rejected") {
    return { ...base, deposit: NO_DEPOSIT };
  }
  if (submission === "submitted" && record.funding) {
    return { ...base, deposit: depositOf(record, undefined, null) };
  }
  return {
    ...base,
    deposit: {
      amountSat: deposit.amountSat,
      confirmations: null,
      status: submission === "submitted" ? "submitted" : "pending",
      txid: deposit.txid,
    },
  };
};
