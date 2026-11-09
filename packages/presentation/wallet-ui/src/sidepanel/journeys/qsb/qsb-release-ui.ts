/**
 * Release one found QSB withdrawal: the review the BIP requires (network,
 * deposit, the 15 one-time keys, the full destination, what it receives, the
 * fee and size) under the prominent unverified-binding statement — and, for a
 * read-only QSB vault's recovered deposit (`custody: "emergency"`), above it
 * the statement that this release is outside custody conformance — then the
 * wallet passphrase and Release and send, which echoes the review's digest so
 * only what was reviewed is released, and sends `emergency` only from an
 * emergency review. Then the outcome: sent, not confirmed
 * yet (with Resend), mined, or a conflict; a review that changed is fetched
 * again and shown again.
 *
 * The review is checked against the deposit's own withdrawal (destination,
 * fee and output) before it is shown; one that disagrees is refused and offers
 * no release. Releases go through the journey's single-flight guard, so a
 * double tap or coming back mid-release only reattaches.
 *
 * Secret boundary: the wallet passphrase is read from its field once, at
 * submit, and the field is emptied as it is sent; it is never held in state,
 * and `wipe` (whenever this screen is left or repainted) empties the field
 * again and drops every reply in flight. The screen shell renders here, beside
 * the binding that owns that field, as the backup screen's does.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState, receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { QSB_VAULT_REFUSALS, type QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import {
  QSB_WITHDRAWAL_REFUSALS,
  type QsbWithdrawalReview,
} from "@bramble/wallet-model/qsb-withdrawals";
import type { WalletStatus } from "../../../popup/responses/responses";
import { friendlyError } from "../../runtime/friendly-error";
import { isOutcomeUnknown } from "../../runtime/runtime-errors";
import { errorLine, renderFragment } from "../../shared/dom";
import { icon } from "../../shared/icons";
import { accountLabel, flowHeader, flowScreen } from "../../shared/parts";
import { isQsbAccessNeeded, type QsbAccess, withQsbAccess } from "./qsb-access";
import type { QsbDepositTarget } from "./qsb-deposit-ui";
import { qsbWriteFailure } from "./qsb-model";
import { qsbReleaseReviewRows } from "./qsb-release-view";
import {
  QSB_ACCESS_LINE,
  QSB_ALLOW_ACCESS,
  QSB_DEPOSIT_SENDING,
  QSB_TX_LINK_LABEL,
  qsbDepositTitle,
} from "./qsb-vault-model";
import type { QsbVaultWallet } from "./qsb-vault-runtime";
import type { QsbVaultWrites } from "./qsb-vault-writes";
import {
  QSB_CUSTODY_TITLE,
  QSB_EMERGENCY_RELEASE_BODY,
  QSB_RELEASE_UNKNOWN_TITLE,
  QSB_REVIEW_LOADING,
  QSB_UNVERIFIED_BODY,
  QSB_UNVERIFIED_TITLE,
  QSB_WITHDRAWAL_COPY,
  qsbWithdrawalLink,
} from "./qsb-withdrawal-model";
import type { QsbWithdrawalResult, QsbWithdrawalWallet } from "./qsb-withdrawal-runtime";

// The steps the Release screen moves between; see bindQsbRelease.
type QsbReleaseStep = "loading" | "outcome" | "review" | "sending" | "unavailable";

/** Renders the Release screen shell, every step but loading hidden. */
export const qsbReleaseFlow = (status: WalletStatus): string =>
  flowHeader("Review withdrawal", status) +
  flowScreen(
    "qsb-release",
    `<div id="qsb-release" class="stack">
      <p class="eyebrow" id="qsb-release-vault"></p>
      <section class="section" data-qsb-release-step="loading">${emptyState(QSB_REVIEW_LOADING, "status")}</section>
      <section class="section" data-qsb-release-step="unavailable" hidden>
        <p class="review-flag" id="qsb-release-error" role="alert"></p>
        ${button({ attributes: { hidden: true, id: "qsb-release-allow" }, icon: "lockKeyholeOpen", label: QSB_ALLOW_ACCESS })}
        ${button({ attributes: { id: "qsb-release-retry" }, label: "Try again", variant: "secondary" })}
        ${button({ attributes: { "data-qsb-release-leave": true }, label: "View QSB vault", variant: "ghost" })}
      </section>
      <section class="section" data-qsb-release-step="review" hidden>
        <form id="qsb-release-form" class="stack" novalidate>
          <div class="qsb-binding-warning" id="qsb-custody-warning" role="note" hidden>
            ${icon("alert")}
            <p><strong>${escapeHtml(QSB_CUSTODY_TITLE)}:</strong> ${escapeHtml(QSB_EMERGENCY_RELEASE_BODY)}</p>
          </div>
          <div class="qsb-binding-warning" id="qsb-binding-warning" role="note">
            ${icon("alert")}
            <p><strong>${escapeHtml(QSB_UNVERIFIED_TITLE)}:</strong> ${escapeHtml(QSB_UNVERIFIED_BODY)}</p>
          </div>
          ${receipt([], { id: "qsb-release-review" })}
          ${textField({
            autocomplete: "current-password",
            label: "Wallet passphrase",
            name: "walletPassphrase",
            required: true,
            type: "password",
          })}
          <p id="qsb-release-result" role="status"></p>
          ${button({ disabled: true, icon: "lockKeyholeOpen", label: "Release and send", type: "submit" })}
        </form>
      </section>
      <section class="section" data-qsb-release-step="sending" hidden>${emptyState(QSB_DEPOSIT_SENDING, "status")}</section>
      <section class="section" data-qsb-release-step="outcome" hidden>
        <h2 id="qsb-release-title"></h2>
        <p id="qsb-release-line" role="status"></p>
        <a class="tx-hash" id="qsb-release-tx" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(QSB_TX_LINK_LABEL)}" hidden><code></code></a>
        ${button({ attributes: { hidden: true, id: "qsb-release-resend" }, label: "Resend" })}
        ${button({ attributes: { "data-qsb-release-leave": true }, label: "Done", variant: "secondary" })}
      </section>
    </div>`,
  );

/** What the Release binding needs. `target` is read live, never copied. */
export type QsbReleaseDeps = {
  readonly access: QsbAccess;
  /** Leaves for the QSB vault screen the review was opened from. */
  readonly back: () => void;
  readonly root: HTMLElement;
  readonly target: () => QsbDepositTarget | null;
  readonly wallet: Pick<QsbVaultWallet, "loadQsbVaults"> &
    Pick<QsbWithdrawalWallet, "releaseQsbWithdrawal" | "reviewQsbWithdrawal">;
  readonly writes: QsbVaultWrites;
};

/** The bound screen; `wipe` empties the passphrase field and drops replies in flight. */
export type QsbReleaseSession = { readonly wipe: () => void };

const refusal = (diagnostic: string): string => friendlyError(diagnostic).message;

// Where a write the screen waits on came from, which decides what a refusal
// leads back to.
type QsbReleaseOrigin = "attached" | "release" | "resend";

// Whether the review describes the withdrawal the deposit was started with:
// the same destination, fee and output.
const matchesWithdrawal = (review: QsbWithdrawalReview, vault: QsbVaultView): boolean =>
  review.destination === vault.withdrawal.destination &&
  review.feeSat === vault.withdrawal.feeSat &&
  review.outputSat === vault.withdrawal.outputSat;

/**
 * Binds the Release steps under `root` and loads the review. Missing controls
 * are skipped. Release and send stays disabled until a review is shown and a
 * passphrase typed.
 */
export const bindQsbRelease = (deps: QsbReleaseDeps): QsbReleaseSession => {
  const { access, root, wallet, writes } = deps;
  const find = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-qsb-release-step]"));
  const form = find<HTMLFormElement>("#qsb-release-form");
  const passphrase = form?.querySelector<HTMLInputElement>('input[name="walletPassphrase"]');
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const result = find<HTMLElement>("#qsb-release-result");
  const outcomeTx = find<HTMLAnchorElement>("#qsb-release-tx");
  const resend = find<HTMLButtonElement>("#qsb-release-resend");
  // Bumped by `wipe`: an answer after it belongs to a screen the user left.
  let generation = 0;
  // Bumped by every read and by `wipe`: only the latest read is applied.
  let ticket = 0;
  let review: QsbWithdrawalReview | null = null;
  // The coordinator grant as last checked or answered; false until checked.
  let accessHeld = false;

  const show = (step: QsbReleaseStep, focus = false): void => {
    for (const section of steps) section.hidden = section.dataset["qsbReleaseStep"] !== step;
    if (!focus) return;
    steps
      .find((section) => !section.hidden)
      ?.querySelector<HTMLElement>("input, button:not([disabled]):not([hidden])")
      ?.focus();
  };
  const text = (selector: string, line: string): void => {
    const node = find<HTMLElement>(selector);
    if (node) node.textContent = line;
  };
  const say = (line: string, refused: boolean): void => {
    if (!result) return;
    const target = result;
    target.textContent = line;
    target.classList.toggle("is-invalid", refused && line.length > 0);
  };
  const clearPassphrase = (): void => {
    if (passphrase) passphrase.value = "";
    if (submit) submit.disabled = true;
  };
  const unavailable = (line: string, action: "allow" | "none" | "retry"): void => {
    const error = find<HTMLElement>("#qsb-release-error");
    if (error) {
      error.textContent = line;
      // A grant still to give is a step, not a failure: it never reads in red.
      error.classList.toggle("review-flag", action !== "allow");
      error.classList.toggle("hint", action === "allow");
    }
    const again = find<HTMLButtonElement>("#qsb-release-retry");
    if (again) again.hidden = action !== "retry";
    const allow = find<HTMLButtonElement>("#qsb-release-allow");
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
  const outcome = (
    title: string,
    line: string,
    vault: QsbVaultView | null,
    offerResend: boolean,
  ) => {
    text("#qsb-release-title", title);
    text("#qsb-release-line", line);
    const link = vault === null ? null : qsbWithdrawalLink(vault);
    const txid = vault?.withdrawal.txid ?? null;
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

  const load = (line = "", refused = false): void => {
    const target = deps.target();
    if (target === null) {
      unavailable(refusal(QSB_VAULT_REFUSALS.unknownVault), "none");
      return;
    }
    const mine = ++ticket;
    review = null;
    clearPassphrase();
    show("loading");
    void (async () => {
      const [reading, held] = await Promise.all([
        wallet.loadQsbVaults(target.accountId),
        access.check(),
      ]);
      if (mine !== ticket) return;
      accessHeld = held;
      const vault = reading.vaults.find((entry) => entry.v === target.v);
      if (!vault) return unavailable(refusal(QSB_VAULT_REFUSALS.unknownVault), "none");
      if (vault.withdrawal.status !== "ready") {
        return unavailable(refusal(QSB_WITHDRAWAL_REFUSALS.notReady), "none");
      }
      if (!held) return unavailable(QSB_ACCESS_LINE, "allow");
      const next = await wallet.reviewQsbWithdrawal(target.accountId, target.v);
      if (mine !== ticket) return;
      if (!matchesWithdrawal(next, vault)) {
        return unavailable(refusal(QSB_WITHDRAWAL_REFUSALS.bindingRefused), "none");
      }
      review = next;
      const custody = find<HTMLElement>("#qsb-custody-warning");
      if (custody) custody.hidden = next.custody !== "emergency";
      const rows = find<HTMLElement>("#qsb-release-review");
      if (rows) renderFragment(rows, qsbReleaseReviewRows(next));
      say(line, refused);
      show("review", true);
    })().catch((error: unknown) => {
      if (mine === ticket) unavailable(errorLine(error, "wallet unavailable"), "retry");
    });
  };

  // Waits on a release or resend: this screen's own, or one already running
  // when it opened.
  const attach = (flight: Promise<QsbWithdrawalResult>, origin: QsbReleaseOrigin): void => {
    const attempt = generation;
    show("sending");
    flight.then(
      ({ submission, vault }) => {
        if (attempt !== generation) return;
        const copy = QSB_WITHDRAWAL_COPY[submission];
        outcome(copy.title, copy.line, vault, submission === "uncertain");
      },
      (error: unknown) => {
        if (attempt !== generation) return;
        if (isOutcomeUnknown(error)) {
          const line = qsbWriteFailure(error, "wallet request failed");
          outcome(QSB_RELEASE_UNKNOWN_TITLE, line, null, false);
          return;
        }
        // A refusal: nothing was released.
        const line = errorLine(error, "wallet request failed");
        const changed =
          error instanceof Error && error.message === QSB_WITHDRAWAL_REFUSALS.reviewChanged;
        if (origin === "resend") {
          outcome(QSB_WITHDRAWAL_COPY.uncertain.title, line, null, true);
        } else if (changed || origin === "attached") {
          load(line, !changed);
        } else {
          say(line, true);
          show("review", true);
        }
      },
    );
  };

  passphrase?.addEventListener("input", () => {
    if (submit) submit.disabled = review === null || passphrase.value.length === 0;
    say("", false);
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const target = deps.target();
    // Read once and emptied as it is sent; a wrong one is typed again.
    const typed = passphrase?.value ?? "";
    clearPassphrase();
    if (target === null || review === null || typed.length === 0) return;
    const { digest } = review;
    const emergency = review.custody === "emergency";
    attach(
      guarded(() =>
        writes.release(target.accountId, target.v, () =>
          wallet.releaseQsbWithdrawal(target.accountId, target.v, digest, typed, emergency),
        ),
      ),
      "release",
    );
  });
  resend?.addEventListener("click", () => {
    const target = deps.target();
    if (target === null) return;
    attach(
      guarded(() => writes.resendWithdrawal(target.accountId, target.v)),
      "resend",
    );
  });
  find<HTMLButtonElement>("#qsb-release-retry")?.addEventListener("click", () => load());
  // The prompt is asked in the click itself; either answer re-reads.
  find<HTMLButtonElement>("#qsb-release-allow")?.addEventListener("click", () => {
    const attempt = generation;
    void access.request().then(() => {
      if (attempt === generation) load();
    });
  });
  for (const control of root.querySelectorAll<HTMLButtonElement>("[data-qsb-release-leave]")) {
    control.addEventListener("click", deps.back);
  }

  const target = deps.target();
  const eyebrow = find<HTMLElement>("#qsb-release-vault");
  if (eyebrow)
    eyebrow.textContent = target === null ? "" : qsbDepositTitle(target.accountId, target.v);
  const running = target === null ? null : writes.pendingWithdrawal(target.accountId, target.v);
  if (running) attach(running, "attached");
  else load();

  return {
    wipe: () => {
      generation += 1;
      ticket += 1;
      review = null;
      clearPassphrase();
      say("", false);
    },
  };
};
