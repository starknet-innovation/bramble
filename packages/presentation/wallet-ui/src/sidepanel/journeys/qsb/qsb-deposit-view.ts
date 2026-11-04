/**
 * Templates for a deposit into one Quantum-safe Bitcoin vault: the static
 * screen shell with every step, and the review's cost rows built from a
 * validated quote. Pure: every dynamic value is escaped here.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState, receipt, receiptRows } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { checkboxField, textField } from "@bramble/ui-kit/fields";
import type { QsbDepositQuote } from "@bramble/wallet-model/qsb-vaults";
import type { WalletStatus } from "../../../popup/responses/responses";
import { flowHeader, flowScreen } from "../../shared/parts";
import { QSB_TITLE } from "./qsb-model";
import {
  btcText,
  QSB_ALLOW_ACCESS,
  QSB_DEPOSIT_FACTS,
  QSB_DEPOSIT_SENDING,
  QSB_TX_LINK_LABEL,
  QSB_VAULTS_LOADING,
} from "./qsb-vault-model";

/** The steps the deposit screen moves between; see {@link bindQsbDeposit}. */
export type QsbDepositStep =
  | "amount"
  | "loading"
  | "outcome"
  | "review"
  | "sending"
  | "unavailable";

/** Renders the deposit screen shell, every step but loading hidden. */
export const qsbDepositFlow = (status: WalletStatus): string =>
  flowHeader("Deposit", status, QSB_TITLE) +
  flowScreen(
    "qsb-deposit",
    `<div id="qsb-deposit" class="stack">
      <p class="eyebrow" id="qsb-deposit-vault"></p>
      <section class="section" data-qsb-deposit-step="loading">${emptyState(QSB_VAULTS_LOADING, "status")}</section>
      <section class="section" data-qsb-deposit-step="unavailable" hidden>
        <p class="review-flag" id="qsb-deposit-error" role="alert"></p>
        ${button({ attributes: { hidden: true, id: "qsb-deposit-allow" }, icon: "lockKeyholeOpen", label: QSB_ALLOW_ACCESS })}
        ${button({ attributes: { id: "qsb-deposit-retry" }, label: "Try again", variant: "secondary" })}
        ${button({ attributes: { "data-qsb-deposit-leave": true }, label: "View account", variant: "ghost" })}
      </section>
      <section class="section" data-qsb-deposit-step="amount" hidden>
        <form id="qsb-amount-form" class="stack" novalidate>
          ${textField({
            autocomplete: "off",
            inputmode: "decimal",
            label: "Amount in BTC",
            maxlength: 20,
            name: "qsbAmount",
            placeholder: "0.001",
            spellcheck: false,
          })}
          <p class="hint" id="qsb-amount-available"></p>
          <p id="qsb-amount-result" role="status"></p>
          ${button({ label: "Review", type: "submit" })}
        </form>
      </section>
      <section class="section" data-qsb-deposit-step="review" hidden>
        <form id="qsb-review-form" class="stack" novalidate>
          ${receipt([], { id: "qsb-deposit-quote" })}
          <div class="review-panel">
            ${QSB_DEPOSIT_FACTS.map((fact) => `<p>${escapeHtml(fact)}</p>`).join("")}
          </div>
          ${checkboxField({ name: "qsbAccept", text: "I accept these costs" })}
          <p id="qsb-review-result" role="status"></p>
          ${button({ disabled: true, label: "Deposit", type: "submit" })}
          ${button({ attributes: { id: "qsb-review-back" }, label: "Change amount", variant: "ghost" })}
        </form>
      </section>
      <section class="section" data-qsb-deposit-step="sending" hidden>${emptyState(QSB_DEPOSIT_SENDING, "status")}</section>
      <section class="section" data-qsb-deposit-step="outcome" hidden>
        <h2 id="qsb-outcome-title"></h2>
        <p id="qsb-outcome-line" role="status"></p>
        <a class="tx-hash" id="qsb-outcome-tx" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(QSB_TX_LINK_LABEL)}" hidden><code></code></a>
        ${button({ attributes: { hidden: true, id: "qsb-outcome-resend" }, label: "Resend" })}
        ${button({ attributes: { "data-qsb-deposit-leave": true }, label: "Done", variant: "secondary" })}
      </section>
    </div>`,
  );

/**
 * The review's cost rows for a validated quote: what goes into the vault, the
 * network fee and its rate, the change back to the owner address (or none),
 * and the estimated fee of the later withdrawal at today's rate.
 */
export const qsbQuoteRows = (quote: QsbDepositQuote): string =>
  receiptRows([
    { label: "Deposit", value: btcText(quote.amountSat), valueStyle: "code" },
    { label: "Network fee", value: btcText(quote.feeSat), valueStyle: "code" },
    { label: "Fee rate", value: `${quote.feeRate} sat/vB`, valueStyle: "code" },
    {
      label: "Change to you",
      value: quote.changeSat === 0 ? "None" : btcText(quote.changeSat),
      valueStyle: quote.changeSat === 0 ? "text" : "code",
    },
    {
      label: "Withdrawal fee, est.",
      value: btcText(quote.withdrawalFeeSat),
      valueStyle: "code",
    },
  ]);
