/**
 * Deposit into one unfunded Quantum-safe Bitcoin vault: an amount in BTC
 * (parsed to satoshis without floating point, at least the minimum deposit and
 * at most the confirmed balance), a quote, a review of every cost with the
 * three facts the user accepts, then the submission and its outcome.
 *
 * The deposit sends the quote's own `feeSat`, the fee the user accepted; a
 * deposit the background would now price differently is refused as
 * `quoteChanged`, and the screen re-quotes and asks again. Writes go through
 * the journey's single-flight guard, so a double tap, a repaint or coming back
 * mid-send only reattaches to the deposit already running. `wipe` empties the
 * form and drops every reply still in flight; the journey calls it whenever
 * this screen is left or repainted.
 */
import {
  QSB_VAULT_REFUSALS,
  type QsbDepositQuote,
  type QsbVaultView,
} from "@bramble/wallet-model/qsb-vaults";
import { friendlyError } from "../../runtime/friendly-error";
import { isOutcomeUnknown } from "../../runtime/runtime-errors";
import { buttonBusy, errorLine, renderFragment } from "../../shared/dom";
import { accountLabel } from "../../shared/parts";
import { type QsbDepositStep, qsbQuoteRows } from "./qsb-deposit-view";
import {
  btcText,
  checkQsbDepositAmount,
  isQsbQuoteChanged,
  QSB_AMOUNT_LINE,
  QSB_DEPOSIT_UNKNOWN_TITLE,
  QSB_FUNDS_UNAVAILABLE,
  QSB_SUBMISSION_COPY,
  qsbDepositable,
  qsbDepositLink,
  qsbVaultTitle,
  qsbVaultWriteFailure,
} from "./qsb-vault-model";
import type { QsbDepositResult, QsbVaultWallet } from "./qsb-vault-runtime";
import type { QsbVaultWrites } from "./qsb-vault-writes";

/** Which vault the deposit screen is for. Ids only. */
export type QsbDepositTarget = { readonly accountId: string; readonly v: number };

/** What the deposit binding needs. `target` is read live, never copied. */
export type QsbDepositDeps = {
  /** Leaves for the account screen the deposit was opened from. */
  readonly back: () => void;
  readonly root: HTMLElement;
  readonly target: () => QsbDepositTarget | null;
  readonly wallet: Pick<QsbVaultWallet, "loadQsbVaults" | "quoteQsbDeposit">;
  readonly writes: QsbVaultWrites;
};

/** The bound screen; `wipe` empties the form and drops replies in flight. */
export type QsbDepositSession = { readonly wipe: () => void };

const refusal = (diagnostic: string): string => friendlyError(diagnostic).message;

// Where a write the screen waits on came from, which decides what a refusal
// leads back to.
type QsbWriteOrigin =
  | { readonly amountSat: number; readonly kind: "deposit" }
  | { readonly kind: "attached" }
  | { readonly kind: "resend" };

/**
 * Binds the deposit steps under `root` and loads the vault and its balance.
 * Missing controls are skipped. Deposit stays disabled until a quote is shown
 * and "I accept these costs" is ticked.
 */
export const bindQsbDeposit = (deps: QsbDepositDeps): QsbDepositSession => {
  const { root, wallet, writes } = deps;
  const find = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-qsb-deposit-step]"));
  const amountForm = find<HTMLFormElement>("#qsb-amount-form");
  const amountInput = amountForm?.querySelector<HTMLInputElement>('input[name="qsbAmount"]');
  const amountSubmit = amountForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const amountResult = find<HTMLElement>("#qsb-amount-result");
  const reviewForm = find<HTMLFormElement>("#qsb-review-form");
  const accept = reviewForm?.querySelector<HTMLInputElement>('input[name="qsbAccept"]');
  const depositSubmit = reviewForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const reviewResult = find<HTMLElement>("#qsb-review-result");
  const outcomeTx = find<HTMLAnchorElement>("#qsb-outcome-tx");
  const resend = find<HTMLButtonElement>("#qsb-outcome-resend");
  // Bumped by `wipe`: an answer after it belongs to a screen the user left.
  let generation = 0;
  // Bumped by every read and by `wipe`: only the latest read is applied.
  let ticket = 0;
  let balanceSat: number | null = null;
  let quote: QsbDepositQuote | null = null;

  const show = (step: QsbDepositStep, focus = false): void => {
    for (const section of steps) section.hidden = section.dataset["qsbDepositStep"] !== step;
    if (!focus) return;
    steps
      .find((section) => !section.hidden)
      ?.querySelector<HTMLElement>("input, button:not([disabled]):not([hidden])")
      ?.focus();
  };
  const text = (selector: string, line: string): void => {
    const target = find<HTMLElement>(selector);
    if (target) target.textContent = line;
  };
  // A status line under a form: a refusal reads as an error to fix, anything
  // else (a changed cost, nothing) as where things stand.
  const say = (node: HTMLElement | null, line: string, refused: boolean): void => {
    if (!node) return;
    const target = node;
    target.textContent = line;
    target.classList.toggle("is-invalid", refused && line.length > 0);
  };
  const unavailable = (line: string, retry: boolean): void => {
    text("#qsb-deposit-error", line);
    const again = find<HTMLButtonElement>("#qsb-deposit-retry");
    if (again) again.hidden = !retry;
    show("unavailable");
  };
  const syncAccept = (): void => {
    if (depositSubmit) depositSubmit.disabled = !(quote !== null && accept?.checked === true);
  };
  const review = (next: QsbDepositQuote, line: string): void => {
    quote = next;
    const rows = find<HTMLElement>("#qsb-deposit-quote");
    if (rows) renderFragment(rows, qsbQuoteRows(next));
    // A new cost is a new decision: it is never accepted on the old one's tick.
    if (accept) accept.checked = false;
    syncAccept();
    say(reviewResult, line, false);
    show("review", true);
  };
  // The outcome step; `vault` is the vault as the reply left it, whose
  // validated txid is the only thing ever linked.
  const outcome = (
    title: string,
    line: string,
    vault: QsbVaultView | null,
    offerResend: boolean,
  ): void => {
    text("#qsb-outcome-title", title);
    text("#qsb-outcome-line", line);
    const link = vault === null ? null : qsbDepositLink(vault);
    const txid = vault?.deposit.txid ?? null;
    if (outcomeTx) {
      outcomeTx.hidden = link === null || txid === null;
      if (link === null || txid === null) outcomeTx.removeAttribute("href");
      else outcomeTx.href = link;
      const code = outcomeTx.querySelector("code");
      if (code) code.textContent = link === null || txid === null ? "" : accountLabel(txid);
    }
    if (resend) resend.hidden = !offerResend;
    show("outcome", true);
  };
  const settled = ({ submission, vault }: QsbDepositResult): void => {
    const copy = QSB_SUBMISSION_COPY[submission];
    outcome(copy.title, copy.line, vault, submission === "uncertain");
  };

  const quoteFor = (amountSat: number, line: string): void => {
    const target = deps.target();
    if (target === null) return;
    const mine = ++ticket;
    buttonBusy(amountSubmit, true);
    say(amountResult, "", false);
    void wallet.quoteQsbDeposit(target.accountId, target.v, amountSat).then(
      (next) => {
        buttonBusy(amountSubmit, false);
        if (mine === ticket) review(next, line);
      },
      (error: unknown) => {
        buttonBusy(amountSubmit, false);
        if (mine !== ticket) return;
        show("amount");
        say(amountResult, errorLine(error, "wallet unavailable"), true);
      },
    );
  };

  // Waits on a deposit or resend: this screen's own deposit (with its
  // amount), its own resend, or a write already running when it opened.
  const attach = (flight: Promise<QsbDepositResult>, origin: QsbWriteOrigin): void => {
    const attempt = generation;
    show("sending");
    flight.then(
      (result) => {
        if (attempt === generation) settled(result);
      },
      (error: unknown) => {
        if (attempt !== generation) return;
        if (isOutcomeUnknown(error)) {
          const line = qsbVaultWriteFailure(error, "wallet request failed");
          outcome(QSB_DEPOSIT_UNKNOWN_TITLE, line, null, false);
          return;
        }
        // A refusal: nothing new was submitted.
        const line = errorLine(error, "wallet request failed");
        if (origin.kind === "resend") {
          outcome(QSB_SUBMISSION_COPY.uncertain.title, line, null, true);
        } else if (origin.kind === "attached") {
          load(line, !isQsbQuoteChanged(error));
        } else if (isQsbQuoteChanged(error)) {
          quoteFor(origin.amountSat, line);
        } else {
          // The same review stands; the user decides again.
          say(reviewResult, line, true);
          syncAccept();
          show("review", true);
        }
      },
    );
  };

  const load = (line = "", refused = false): void => {
    const target = deps.target();
    if (target === null) {
      unavailable(refusal(QSB_VAULT_REFUSALS.unknownVault), false);
      return;
    }
    const mine = ++ticket;
    show("loading");
    void wallet.loadQsbVaults(target.accountId).then(
      (reading) => {
        if (mine !== ticket) return;
        const vault = reading.vaults.find((entry) => entry.v === target.v);
        if (!vault) return unavailable(refusal(QSB_VAULT_REFUSALS.unknownVault), false);
        if (!qsbDepositable(vault)) {
          return unavailable(refusal(QSB_VAULT_REFUSALS.notDepositable), false);
        }
        if (reading.funds === null) {
          return unavailable(QSB_FUNDS_UNAVAILABLE, true);
        }
        balanceSat = reading.funds.totalSat;
        text("#qsb-amount-available", `Confirmed balance: ${btcText(balanceSat)}`);
        say(amountResult, line, refused);
        show("amount", true);
      },
      (error: unknown) => {
        if (mine === ticket) unavailable(errorLine(error, "wallet unavailable"), true);
      },
    );
  };

  amountInput?.addEventListener("input", () => say(amountResult, "", false));
  amountForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (balanceSat === null || amountInput == null) return;
    const check = checkQsbDepositAmount(amountInput.value, balanceSat);
    if (check.kind !== "ok") {
      say(amountResult, QSB_AMOUNT_LINE[check.kind], true);
      amountInput.focus();
      return;
    }
    quoteFor(check.sat, "");
  });
  accept?.addEventListener("change", syncAccept);
  reviewForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const target = deps.target();
    if (target === null || quote === null || accept?.checked !== true) return;
    attach(writes.deposit(target.accountId, target.v, quote.amountSat, quote.feeSat), {
      amountSat: quote.amountSat,
      kind: "deposit",
    });
  });
  find<HTMLButtonElement>("#qsb-review-back")?.addEventListener("click", () => {
    quote = null;
    if (accept) accept.checked = false;
    syncAccept();
    show("amount", true);
  });
  resend?.addEventListener("click", () => {
    const target = deps.target();
    if (target !== null) attach(writes.resend(target.accountId, target.v), { kind: "resend" });
  });
  find<HTMLButtonElement>("#qsb-deposit-retry")?.addEventListener("click", () => load());
  for (const control of root.querySelectorAll<HTMLButtonElement>("[data-qsb-deposit-leave]")) {
    control.addEventListener("click", deps.back);
  }

  const target = deps.target();
  text("#qsb-deposit-vault", target === null ? "" : qsbVaultTitle(target.accountId, target.v));
  const running = target === null ? null : writes.pendingDeposit(target.accountId, target.v);
  if (running) attach(running, { kind: "attached" });
  else load();

  return {
    wipe: () => {
      generation += 1;
      ticket += 1;
      balanceSat = null;
      quote = null;
      if (amountInput) amountInput.value = "";
      if (accept) accept.checked = false;
      syncAccept();
      say(reviewResult, "", false);
    },
  };
};
