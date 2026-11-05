/**
 * Start the withdrawal of one funded QSB deposit: a destination address, a
 * quote, a summary of what the destination receives (the deposit plus the
 * helper, less the network fee) with the one line that the search can take
 * hours and the fee can't change later, then Start withdrawal once the costs
 * are accepted, and back to the QSB vault screen.
 *
 * The start sends the quote's own `feeSat`, the fee the user accepted; a
 * withdrawal the background would now price differently is refused as
 * `quoteChanged`, and the screen quotes again and asks again. Starts go
 * through the journey's single-flight guard, so a double tap or coming back
 * mid-start only reattaches. The coordinator origin is granted at runtime:
 * without it the screen offers Allow access, and Review and Start ask for it
 * in their own click. `wipe` empties the form and drops every reply in
 * flight; the journey calls it whenever this screen is left or repainted.
 */
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import {
  QSB_WITHDRAWAL_REFUSALS,
  type QsbWithdrawalQuote,
} from "@bramble/wallet-model/qsb-withdrawals";
import { friendlyError } from "../../runtime/friendly-error";
import { isOutcomeUnknown } from "../../runtime/runtime-errors";
import { buttonBusy, errorLine, renderFragment } from "../../shared/dom";
import { isQsbAccessNeeded, type QsbAccess, withQsbAccess } from "./qsb-access";
import type { QsbDepositTarget } from "./qsb-deposit-ui";
import { qsbWriteFailure } from "./qsb-model";
import { QSB_ACCESS_LINE, qsbDepositTitle } from "./qsb-vault-model";
import { isQsbDestination, type QsbVaultWallet } from "./qsb-vault-runtime";
import type { QsbVaultWrites } from "./qsb-vault-writes";
import { type QsbWithdrawStep, qsbWithdrawQuoteRows } from "./qsb-withdraw-view";
import { qsbTypedDestination, qsbWithdrawable } from "./qsb-withdrawal-model";
import type { QsbWithdrawalWallet } from "./qsb-withdrawal-runtime";

/** What the Withdraw binding needs. `target` is read live, never copied. */
export type QsbWithdrawDeps = {
  readonly access: QsbAccess;
  /** Leaves for the QSB vault screen the Withdraw was opened from. */
  readonly back: () => void;
  readonly root: HTMLElement;
  readonly target: () => QsbDepositTarget | null;
  readonly wallet: Pick<QsbVaultWallet, "loadQsbVaults"> &
    Pick<QsbWithdrawalWallet, "quoteQsbWithdrawal">;
  readonly writes: QsbVaultWrites;
};

/** The bound screen; `wipe` empties the form and drops replies in flight. */
export type QsbWithdrawSession = { readonly wipe: () => void };

const refusal = (diagnostic: string): string => friendlyError(diagnostic).message;

/**
 * Binds the Withdraw steps under `root` and loads the deposit. Missing
 * controls are skipped. Start withdrawal stays disabled until a quote is shown
 * and "I accept these costs" is ticked.
 */
export const bindQsbWithdraw = (deps: QsbWithdrawDeps): QsbWithdrawSession => {
  const { access, root, wallet, writes } = deps;
  const find = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-qsb-withdraw-step]"));
  const destinationForm = find<HTMLFormElement>("#qsb-destination-form");
  const destinationInput = destinationForm?.querySelector<HTMLInputElement>(
    'input[name="qsbDestination"]',
  );
  const review = destinationForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const destinationResult = find<HTMLElement>("#qsb-destination-result");
  const summaryForm = find<HTMLFormElement>("#qsb-withdraw-form");
  const accept = summaryForm?.querySelector<HTMLInputElement>('input[name="qsbWithdrawAccept"]');
  const start = summaryForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const summaryResult = find<HTMLElement>("#qsb-withdraw-result");
  // Bumped by `wipe`: an answer after it belongs to a screen the user left.
  let generation = 0;
  // Bumped by every read and by `wipe`: only the latest read is applied.
  let ticket = 0;
  let quote: QsbWithdrawalQuote | null = null;
  // The coordinator grant as last checked or answered; false until checked.
  let accessHeld = false;

  const show = (step: QsbWithdrawStep, focus = false): void => {
    for (const section of steps) section.hidden = section.dataset["qsbWithdrawStep"] !== step;
    if (!focus) return;
    steps
      .find((section) => !section.hidden)
      ?.querySelector<HTMLElement>("input, button:not([disabled]):not([hidden])")
      ?.focus();
  };
  // A status line under a form: a refusal reads as an error to fix, anything
  // else (a changed cost, nothing) as where things stand.
  const say = (node: HTMLElement | null, line: string, refused: boolean): void => {
    if (!node) return;
    const target = node;
    target.textContent = line;
    target.classList.toggle("is-invalid", refused && line.length > 0);
  };
  // Why the screen cannot go on, and the one way forward if there is one.
  const unavailable = (line: string, action: "allow" | "none" | "retry"): void => {
    const error = find<HTMLElement>("#qsb-withdraw-error");
    if (error) {
      error.textContent = line;
      // A grant still to give is a step, not a failure: it never reads in red.
      error.classList.toggle("review-flag", action !== "allow");
      error.classList.toggle("hint", action === "allow");
    }
    const again = find<HTMLButtonElement>("#qsb-withdraw-retry");
    if (again) again.hidden = action !== "retry";
    const allow = find<HTMLButtonElement>("#qsb-withdraw-allow");
    if (allow) allow.hidden = action !== "allow";
    show("unavailable", action === "allow");
  };
  const guarded = <T>(send: () => Promise<T>): Promise<T> => {
    const flight = withQsbAccess(access, accessHeld, () => {
      accessHeld = true;
      return send();
    });
    flight.catch((error: unknown) => {
      if (isQsbAccessNeeded(error)) accessHeld = false;
    });
    return flight;
  };
  const syncAccept = (): void => {
    if (start) start.disabled = !(quote !== null && accept?.checked === true);
  };
  const summary = (next: QsbWithdrawalQuote, line: string): void => {
    quote = next;
    const rows = find<HTMLElement>("#qsb-withdraw-quote");
    if (rows) renderFragment(rows, qsbWithdrawQuoteRows(next));
    // A new cost is a new decision: it is never accepted on the old one's tick.
    if (accept) accept.checked = false;
    syncAccept();
    say(summaryResult, line, false);
    show("summary", true);
  };

  const quoteFor = (destination: string, line: string): void => {
    const target = deps.target();
    if (target === null) return;
    const mine = ++ticket;
    buttonBusy(review, true);
    say(destinationResult, "", false);
    void guarded(() => wallet.quoteQsbWithdrawal(target.accountId, target.v, destination)).then(
      (next) => {
        buttonBusy(review, false);
        if (mine === ticket) summary(next, line);
      },
      (error: unknown) => {
        buttonBusy(review, false);
        if (mine !== ticket) return;
        show("destination");
        say(destinationResult, errorLine(error, "wallet unavailable"), true);
      },
    );
  };

  // Waits on a start, this screen's own (with its destination) or one already
  // running when it opened; a started withdrawal goes back to the QSB vault.
  const attach = (flight: Promise<unknown>, destination: string | null): void => {
    const attempt = generation;
    show("starting");
    flight.then(
      () => {
        if (attempt === generation) deps.back();
      },
      (error: unknown) => {
        if (attempt !== generation) return;
        if (isOutcomeUnknown(error) || destination === null) {
          unavailable(qsbWriteFailure(error, "wallet request failed"), "none");
          return;
        }
        const line = errorLine(error, "wallet request failed");
        if (error instanceof Error && error.message === QSB_WITHDRAWAL_REFUSALS.quoteChanged) {
          quoteFor(destination, line);
          return;
        }
        // A refusal: nothing was started, so the same summary stands.
        say(summaryResult, line, true);
        syncAccept();
        show("summary", true);
      },
    );
  };

  const load = (): void => {
    const target = deps.target();
    if (target === null) {
      unavailable(refusal(QSB_VAULT_REFUSALS.unknownVault), "none");
      return;
    }
    const mine = ++ticket;
    show("loading");
    void Promise.all([wallet.loadQsbVaults(target.accountId), access.check()]).then(
      ([reading, held]) => {
        if (mine !== ticket) return;
        accessHeld = held;
        const vault = reading.vaults.find((entry) => entry.v === target.v);
        if (!vault) return unavailable(refusal(QSB_VAULT_REFUSALS.unknownVault), "none");
        if (!qsbWithdrawable(vault)) {
          return unavailable(refusal(QSB_WITHDRAWAL_REFUSALS.notWithdrawable), "none");
        }
        if (!held) return unavailable(QSB_ACCESS_LINE, "allow");
        show("destination", true);
      },
      (error: unknown) => {
        if (mine === ticket) unavailable(errorLine(error, "wallet unavailable"), "retry");
      },
    );
  };

  destinationInput?.addEventListener("input", () => say(destinationResult, "", false));
  destinationForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (destinationInput == null) return;
    const destination = qsbTypedDestination(destinationInput.value);
    if (!isQsbDestination(destination)) {
      say(destinationResult, refusal(QSB_WITHDRAWAL_REFUSALS.destinationInvalid), true);
      destinationInput.focus();
      return;
    }
    quoteFor(destination, "");
  });
  accept?.addEventListener("change", syncAccept);
  summaryForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const target = deps.target();
    if (target === null || quote === null || accept?.checked !== true) return;
    const { destination, feeSat } = quote;
    attach(
      guarded(() => writes.startWithdrawal(target.accountId, target.v, destination, feeSat)),
      destination,
    );
  });
  find<HTMLButtonElement>("#qsb-withdraw-back")?.addEventListener("click", () => {
    quote = null;
    if (accept) accept.checked = false;
    syncAccept();
    show("destination", true);
  });
  find<HTMLButtonElement>("#qsb-withdraw-retry")?.addEventListener("click", () => load());
  // The prompt is asked in the click itself; either answer re-reads.
  find<HTMLButtonElement>("#qsb-withdraw-allow")?.addEventListener("click", () => {
    const attempt = generation;
    void access.request().then(() => {
      if (attempt === generation) load();
    });
  });
  for (const control of root.querySelectorAll<HTMLButtonElement>("[data-qsb-withdraw-leave]")) {
    control.addEventListener("click", deps.back);
  }

  const target = deps.target();
  const eyebrow = find<HTMLElement>("#qsb-withdraw-vault");
  if (eyebrow)
    eyebrow.textContent = target === null ? "" : qsbDepositTitle(target.accountId, target.v);
  const running = target === null ? null : writes.pendingStart(target.accountId, target.v);
  if (running) attach(running, null);
  else load();

  return {
    wipe: () => {
      generation += 1;
      ticket += 1;
      quote = null;
      if (destinationInput) destinationInput.value = "";
      if (accept) accept.checked = false;
      syncAccept();
      say(summaryResult, "", false);
    },
  };
};
