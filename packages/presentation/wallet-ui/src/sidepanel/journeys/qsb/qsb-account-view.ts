/**
 * Templates for one QSB vault: the static screen shell, then the regions its
 * binding fills once `wallet.qsbVaults` answers — the confirmed balance and
 * one row per deposit (the contract's vault) with its deposit or withdrawal
 * state and its one action. Pure: every dynamic value is escaped here or comes
 * from a validated view, and the only links are built by `qsbDepositLink` and
 * `qsbWithdrawalLink` from a validated txid.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState, receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import type { QsbOwnerFunds, QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { accountLabel, flowHeader, flowScreen } from "../../shared/parts";
import { QSB_NAME } from "./qsb-model";
import {
  btcText,
  QSB_ACCESS_LINE,
  QSB_ADDRESS_HINT,
  QSB_ALLOW_ACCESS,
  QSB_FUNDS_UNAVAILABLE,
  QSB_TX_LINK_LABEL,
  QSB_VAULT_CONFIRM,
  QSB_VAULT_CREATING,
  QSB_VAULTS_EMPTY,
  QSB_VAULTS_LOADING,
  qsbDepositable,
  qsbDepositLabel,
  qsbDepositLink,
  qsbVaultDisplay,
  qsbVaultStatusText,
} from "./qsb-vault-model";
import {
  qsbWithdrawable,
  qsbWithdrawalDisplay,
  qsbWithdrawalHint,
  qsbWithdrawalLink,
  qsbWithdrawalStatusText,
} from "./qsb-withdrawal-model";

/** The steps the account screen moves between; see {@link bindQsbAccount}. */
export type QsbAccountStep = "confirm" | "creating" | "detail" | "loading" | "unavailable";

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
  /** Whether the account may fund, withdraw and release (a writer). */
  readonly writer: boolean;
  /** Whether vault `v` has a write in flight (funding, resend, start or release). */
  readonly busy: (v: number) => boolean;
};

// The one action a row offers: its control's data attribute, label and
// screen-reader verb ("Fund deposit 1").
type RowAction = { readonly attribute: string; readonly label: string; readonly verb: string };

const rowAction = (vault: QsbVaultView, writer: boolean): RowAction | null => {
  const withdrawal = qsbWithdrawalDisplay(vault);
  if (withdrawal === "ready" && writer) {
    return { attribute: "data-qsb-review", label: "Review", verb: "Review the withdrawal of" };
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
  if (writer && qsbWithdrawable(vault)) {
    return { attribute: "data-qsb-withdraw", label: "Withdraw", verb: "Withdraw" };
  }
  return null;
};

const vaultAction = (vault: QsbVaultView, options: QsbVaultRowOptions): string => {
  const action = rowAction(vault, options.writer);
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

// The row's status line and hint: its withdrawal's once one has started,
// otherwise its deposit's.
const vaultStatus = (vault: QsbVaultView): string => {
  const withdrawal = qsbWithdrawalDisplay(vault);
  if (withdrawal === null)
    return `<span class="hint">${escapeHtml(qsbVaultStatusText(vault))}</span>`;
  const hint = qsbWithdrawalHint(withdrawal);
  return `<span class="hint">${escapeHtml(qsbWithdrawalStatusText(withdrawal, vault))}</span>${
    hint === null ? "" : `<span class="hint">${escapeHtml(hint)}</span>`
  }`;
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
      ${vaultStatus(vault)}
      ${vault.deposit.amountSat === null ? "" : `<span class="hint">${escapeHtml(btcText(vault.deposit.amountSat))}</span>`}
      ${vaultLink(vault)}
    </span>
    ${vaultAction(vault, options)}
  </li>`;

/** The vault list: the empty state, or one row per vault in index order. */
export const qsbVaultRows = (
  vaults: readonly QsbVaultView[],
  options: QsbVaultRowOptions,
): string =>
  vaults.length === 0
    ? emptyState(QSB_VAULTS_EMPTY)
    : `<ul class="allowance-list">${vaults.map((vault) => vaultRow(vault, options)).join("")}</ul>`;

/** Below the list: New deposit for a writer, otherwise the line saying why not. */
export const qsbVaultActionMarkup = (noVaultLine: string | null, busy: boolean): string =>
  noVaultLine === null
    ? button({
        attributes: { id: "qsb-vault-new" },
        disabled: busy,
        icon: "plus",
        label: "New deposit",
        variant: "secondary",
      })
    : `<p class="hint">${escapeHtml(noVaultLine)}</p>`;
