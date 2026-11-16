/**
 * Templates for one QSB vault: the static screen shell, then the regions its
 * binding fills once `wallet.qsbVaults` answers — the confirmed balance and
 * one row per deposit (the contract's vault) with its deposit or withdrawal
 * state and its one action — and the Recover deposits step a read-only QSB
 * vault offers, under the warning that it is outside custody conformance. Pure: every dynamic value is escaped here or comes
 * from a validated view, and the only links are built by `qsbDepositLink` and
 * `qsbWithdrawalLink` from a validated txid.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState, receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import type { QsbOwnerFunds, QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import type { WalletStatus } from "../../../popup/responses/responses";
import { friendlyError } from "../../runtime/friendly-error";
import { icon } from "../../shared/icons";
import { accountLabel, flowHeader, flowScreen } from "../../shared/parts";
import { QSB_NAME } from "./qsb-model";
import {
  btcText,
  QSB_ACCESS_LINE,
  QSB_ADDRESS_HINT,
  QSB_ALLOW_ACCESS,
  QSB_BACK_UP_LABEL,
  QSB_FUNDS_UNAVAILABLE,
  QSB_RECOVER_BODY,
  QSB_RECOVER_LABEL,
  QSB_RECOVERING,
  QSB_TX_LINK_LABEL,
  QSB_VAULT_CONFIRM,
  QSB_VAULT_CREATING,
  QSB_VAULT_STEPS,
  QSB_VAULTS_EMPTY,
  QSB_VAULTS_LOADING,
  type QsbRecoverOffer,
  qsbDepositable,
  qsbDepositLabel,
  qsbDepositLink,
  qsbVaultDisplay,
  qsbVaultHint,
  qsbVaultStatusText,
} from "./qsb-vault-model";
import {
  QSB_CUSTODY_TITLE,
  qsbReviewable,
  qsbWithdrawable,
  qsbWithdrawalDisplay,
  qsbWithdrawalHint,
  qsbWithdrawalLink,
  qsbWithdrawalStatusText,
} from "./qsb-withdrawal-model";

/** The steps the account screen moves between; see {@link bindQsbAccount}. */
export type QsbAccountStep =
  | "confirm"
  | "creating"
  | "detail"
  | "loading"
  | "recover"
  | "recovering"
  | "unavailable";

/**
 * Renders the QSB vault screen shell, every step but loading hidden. Its
 * title reads "QSB vault" until the binding names the one open.
 */
export const qsbAccountFlow = (status: WalletStatus): string =>
  flowHeader(QSB_NAME, status) +
  flowScreen(
    "qsb-account",
    `<div id="qsb-account" class="stack">
      <section class="section" data-qsb-account-step="loading">${emptyState(QSB_VAULTS_LOADING, "status")}</section>
      <section class="section" data-qsb-account-step="unavailable" hidden>
        <p class="review-flag" id="qsb-account-error" role="alert"></p>
        ${button({ attributes: { id: "qsb-account-retry" }, label: "Try again", variant: "secondary" })}
      </section>
      <div class="stack" data-qsb-account-step="detail" hidden>
        <section class="section">
          <p class="eyebrow">Bitcoin address</p>
          <button class="receive-address-copy" id="qsb-address-copy" type="button" data-copy="" aria-label="Copy Bitcoin address" aria-describedby="qsb-address" disabled>
            <code id="qsb-address"></code>
            <span class="receive-address-copy-mark" aria-hidden="true">${icon("copy")}</span>
          </button>
          <p class="hint">${escapeHtml(QSB_ADDRESS_HINT)}</p>
        </section>
        <section class="section" id="qsb-balance"></section>
        <section class="section">
          <p class="eyebrow">Deposits</p>
          <div id="qsb-vaults"></div>
          <p id="qsb-vault-result" role="status"></p>
          <div class="stack" id="qsb-vault-action"></div>
          ${button({ attributes: { id: "qsb-account-refresh" }, icon: "refresh", label: "Refresh", variant: "ghost" })}
        </section>
      </div>
      <section class="section" data-qsb-account-step="confirm" hidden>
        <h2>New deposit</h2>
        <p>${escapeHtml(QSB_VAULT_CONFIRM)}</p>
        ${button({ attributes: { id: "qsb-vault-create" }, label: "Create deposit" })}
        ${button({ attributes: { id: "qsb-vault-cancel" }, label: "Cancel", variant: "ghost" })}
      </section>
      <section class="section" data-qsb-account-step="creating" hidden>${emptyState(QSB_VAULT_CREATING, "status")}</section>
      <section class="section stack" data-qsb-account-step="recover" hidden>
        <h2>${escapeHtml(QSB_RECOVER_LABEL)}</h2>
        <div class="qsb-binding-warning" role="note">
          ${icon("alert")}
          <p><strong>${escapeHtml(QSB_CUSTODY_TITLE)}:</strong> ${escapeHtml(QSB_RECOVER_BODY)}</p>
        </div>
        ${button({ attributes: { id: "qsb-recover-start" }, label: QSB_RECOVER_LABEL })}
        ${button({ attributes: { id: "qsb-recover-cancel" }, label: "Cancel", variant: "ghost" })}
      </section>
      <section class="section" data-qsb-account-step="recovering" hidden>${emptyState(QSB_RECOVERING, "status")}</section>
    </div>`,
  );

/**
 * The balance region: while the coordinator origin is not granted
 * (`accessHeld` false), a line saying so with Allow access; otherwise the
 * confirmed funds in BTC, or, when the coordinator could not be reached
 * (`funds` null), a line saying so with a retry.
 */
export const qsbBalanceMarkup = (funds: QsbOwnerFunds | null, accessHeld: boolean): string => {
  if (!accessHeld) {
    return `<p class="hint" role="status">${escapeHtml(QSB_ACCESS_LINE)}</p>
      ${button({ attributes: { "data-qsb-allow": true }, icon: "lockKeyholeOpen", label: QSB_ALLOW_ACCESS, size: "small", variant: "secondary" })}`;
  }
  return funds === null
    ? `<p class="hint" role="status">${escapeHtml(QSB_FUNDS_UNAVAILABLE)}</p>
      ${button({ attributes: { "data-qsb-retry": true }, label: "Try again", size: "small", variant: "secondary" })}`
    : receipt([{ label: "Confirmed balance", value: btcText(funds.totalSat), valueStyle: "code" }]);
};

/** Which of a vault row's actions to offer, and which are running now. */
export type QsbVaultRowOptions = {
  /**
   * Whether the account may fund, withdraw and release (a writer). A
   * read-only account may only review a recovered deposit's withdrawal, as
   * an emergency release.
   */
  readonly writer: boolean;
  /** Whether vault `v` has a write in flight (funding, resend, start or release). */
  readonly busy: (v: number) => boolean;
  /**
   * The confirmed balance, or null when unknown (no grant, or the service
   * could not be reached). At 0 a withdrawal can't pay its helper input, so
   * Withdraw gives way to the line saying what to do; unknown keeps Withdraw.
   */
  readonly balanceSat: number | null;
};

// The one action a row offers: its control's data attribute, label and
// screen-reader verb ("Fund deposit 1").
type RowAction = { readonly attribute: string; readonly label: string; readonly verb: string };

// A funded deposit the writer could withdraw but for an empty balance.
const needsBalance = (vault: QsbVaultView, options: QsbVaultRowOptions): boolean =>
  options.writer && options.balanceSat === 0 && qsbWithdrawable(vault);

const rowAction = (vault: QsbVaultView, options: QsbVaultRowOptions): RowAction | null => {
  const { writer } = options;
  const withdrawal = qsbWithdrawalDisplay(vault);
  if (qsbReviewable(vault, writer)) {
    return { attribute: "data-qsb-review", label: "Finish", verb: "Finish the withdrawal of" };
  }
  if (withdrawal === "uncertain") {
    return {
      attribute: "data-qsb-resend-withdrawal",
      label: "Resend",
      verb: "Resend the withdrawal of",
    };
  }
  if (withdrawal !== null) return null;
  if (writer && qsbDepositable(vault))
    return { attribute: "data-qsb-deposit", label: "Fund", verb: "Fund" };
  if (qsbVaultDisplay(vault) === "waiting") {
    return { attribute: "data-qsb-resend", label: "Resend", verb: "Resend" };
  }
  if (writer && qsbWithdrawable(vault) && !needsBalance(vault, options)) {
    return { attribute: "data-qsb-withdraw", label: "Withdraw", verb: "Withdraw" };
  }
  return null;
};

const vaultAction = (vault: QsbVaultView, options: QsbVaultRowOptions): string => {
  const action = rowAction(vault, options);
  if (action === null) return "";
  const busy = options.busy(vault.v);
  return button({
    attributes: {
      "aria-label": `${action.verb} ${qsbDepositLabel(vault.v).toLowerCase()}`,
      "data-busy": busy,
      [action.attribute]: String(vault.v),
    },
    disabled: busy,
    label: action.label,
    size: "small",
    variant: "secondary",
  });
};

const hintLine = (line: string | null): string =>
  line === null ? "" : `<span class="hint">${escapeHtml(line)}</span>`;

// The row's status line and hint: its withdrawal's once one has started,
// otherwise its deposit's, or why Withdraw is not offered yet.
const vaultStatus = (vault: QsbVaultView, options: QsbVaultRowOptions): string => {
  const withdrawal = qsbWithdrawalDisplay(vault);
  if (withdrawal === null) {
    const hint = needsBalance(vault, options)
      ? friendlyError(QSB_WITHDRAWAL_REFUSALS.helperNeeded).message
      : qsbVaultHint(vault);
    return hintLine(qsbVaultStatusText(vault)) + hintLine(hint);
  }
  return (
    hintLine(qsbWithdrawalStatusText(withdrawal, vault)) + hintLine(qsbWithdrawalHint(withdrawal))
  );
};

// The withdrawal's transaction once MARA has it, otherwise the deposit's.
const vaultLink = (vault: QsbVaultView): string => {
  const withdrawalLink = qsbWithdrawalLink(vault);
  const [link, txid] =
    withdrawalLink === null
      ? [qsbDepositLink(vault), vault.deposit.txid]
      : [withdrawalLink, vault.withdrawal.txid];
  return link === null || txid === null
    ? ""
    : `<a class="tx-hash" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(QSB_TX_LINK_LABEL)}" data-qsb-tx><code>${escapeHtml(accountLabel(txid))}</code></a>`;
};

const vaultRow = (vault: QsbVaultView, options: QsbVaultRowOptions): string =>
  `<li class="allowance-row" data-qsb-vault="${vault.v}">
    <span class="allowance-copy">
      <strong>${escapeHtml(qsbDepositLabel(vault.v))}</strong>
      ${vaultStatus(vault, options)}
      ${vault.deposit.amountSat === null ? "" : `<span class="hint">${escapeHtml(btcText(vault.deposit.amountSat))}</span>`}
      ${vaultLink(vault)}
    </span>
    ${vaultAction(vault, options)}
  </li>`;

// A writer's empty vault list: how a deposit comes to be, in three steps.
const vaultSteps = (): string =>
  `<ol class="qsb-steps" aria-label="How to deposit">${QSB_VAULT_STEPS.map(
    (step) => `<li>${escapeHtml(step)}</li>`,
  ).join("")}</ol>`;

/**
 * The vault list: for none, the three steps to a deposit when the account can
 * take one, otherwise the empty state; else one row per vault in index order.
 */
export const qsbVaultRows = (
  vaults: readonly QsbVaultView[],
  options: QsbVaultRowOptions,
): string =>
  vaults.length === 0
    ? options.writer
      ? vaultSteps()
      : emptyState(QSB_VAULTS_EMPTY)
    : `<ul class="allowance-list">${vaults.map((vault) => vaultRow(vault, options)).join("")}</ul>`;

/**
 * Below the list: New deposit for a writer, otherwise the line saying why
 * not (with Back up phrase beside it when `backUp`, the one fix), then
 * Recover deposits when `recover` offers it.
 */
export const qsbVaultActionMarkup = (
  noVaultLine: string | null,
  busy: boolean,
  recover: QsbRecoverOffer = "none",
  backUp = false,
): string =>
  (noVaultLine === null
    ? button({
        attributes: { id: "qsb-vault-new" },
        disabled: busy,
        icon: "plus",
        label: "New deposit",
        variant: "secondary",
      })
    : `<p class="hint">${escapeHtml(noVaultLine)}</p>`) +
  (backUp
    ? button({
        attributes: { id: "qsb-vault-backup" },
        icon: "lock",
        label: QSB_BACK_UP_LABEL,
      })
    : "") +
  (recover === "none"
    ? ""
    : button({
        attributes: { id: "qsb-recover-open" },
        disabled: busy,
        label: QSB_RECOVER_LABEL,
        variant: recover === "main" ? "primary" : "secondary",
      }));
