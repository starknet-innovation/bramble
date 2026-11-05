/**
 * Templates for starting the withdrawal of one funded QSB deposit: the static
 * screen shell with every step, and the summary built from a validated quote.
 * Pure: every dynamic value is escaped here.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState, receipt, receiptRows } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { checkboxField, textField } from "@bramble/ui-kit/fields";
import type { QsbWithdrawalQuote } from "@bramble/wallet-model/qsb-withdrawals";
import type { WalletStatus } from "../../../popup/responses/responses";
import { flowHeader, flowScreen } from "../../shared/parts";
import { btcText, QSB_ALLOW_ACCESS, QSB_VAULTS_LOADING } from "./qsb-vault-model";
import { QSB_WITHDRAW_STARTING, QSB_WITHDRAW_TERMS } from "./qsb-withdrawal-model";

/** The steps the Withdraw screen moves between; see {@link bindQsbWithdraw}. */
export type QsbWithdrawStep = "destination" | "loading" | "starting" | "summary" | "unavailable";

/** Renders the Withdraw screen shell, every step but loading hidden. */
export const qsbWithdrawFlow = (status: WalletStatus): string =>
  flowHeader("Withdraw", status) +
  flowScreen(
    "qsb-withdraw",
    `<div id="qsb-withdraw" class="stack">
      <p class="eyebrow" id="qsb-withdraw-vault"></p>
      <section class="section" data-qsb-withdraw-step="loading">${emptyState(QSB_VAULTS_LOADING, "status")}</section>
      <section class="section" data-qsb-withdraw-step="unavailable" hidden>
        <p class="review-flag" id="qsb-withdraw-error" role="alert"></p>
        ${button({ attributes: { hidden: true, id: "qsb-withdraw-allow" }, icon: "lockKeyholeOpen", label: QSB_ALLOW_ACCESS })}
        ${button({ attributes: { id: "qsb-withdraw-retry" }, label: "Try again", variant: "secondary" })}
        ${button({ attributes: { "data-qsb-withdraw-leave": true }, label: "View QSB vault", variant: "ghost" })}
      </section>
      <section class="section" data-qsb-withdraw-step="destination" hidden>
        <form id="qsb-destination-form" class="stack" novalidate>
          ${textField({
            autocapitalize: "off",
            autocomplete: "off",
            label: "Destination address",
            maxlength: 100,
            name: "qsbDestination",
            spellcheck: false,
          })}
          <p id="qsb-destination-result" role="status"></p>
          ${button({ label: "Review", type: "submit" })}
        </form>
      </section>
      <section class="section" data-qsb-withdraw-step="summary" hidden>
        <form id="qsb-withdraw-form" class="stack" novalidate>
          ${receipt([], { id: "qsb-withdraw-quote" })}
          <p class="hint">${escapeHtml(QSB_WITHDRAW_TERMS)}</p>
          ${checkboxField({ name: "qsbWithdrawAccept", text: "I accept these costs" })}
          <p id="qsb-withdraw-result" role="status"></p>
          ${button({ disabled: true, label: "Start withdrawal", type: "submit" })}
          ${button({ attributes: { id: "qsb-withdraw-back" }, label: "Change address", variant: "ghost" })}
        </form>
      </section>
      <section class="section" data-qsb-withdraw-step="starting" hidden>${emptyState(QSB_WITHDRAW_STARTING, "status")}</section>
    </div>`,
  );

/**
 * The summary's rows for a validated quote, as the sum the destination
 * receives: the deposit, plus the helper from the QSB vault's own address,
 * less the network fee; then where it goes and at what rate.
 */
export const qsbWithdrawQuoteRows = (quote: QsbWithdrawalQuote): string =>
  receiptRows([
    { label: "Deposit", value: btcText(quote.fundingSat), valueStyle: "code" },
    { label: "From your address", value: `+ ${btcText(quote.helperSat)}`, valueStyle: "code" },
    { label: "Network fee", value: `− ${btcText(quote.feeSat)}`, valueStyle: "code" },
    { label: "You receive", value: btcText(quote.outputSat), valueStyle: "code" },
    { label: "To", value: quote.destination, valueStyle: "code" },
    { label: "Fee rate", value: `${quote.feeRate} sat/vB`, valueStyle: "code" },
  ]);
