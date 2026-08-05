/**
 * Compose-card bindings for the shield/unshield screen: the amount field and
 * its live projection, and the flip that swaps which balance is the source.
 *
 * Both of those are transient *inputs*, and both are mirrored into journey state
 * as the user changes them. The card is rebuilt from scratch by any repaint —
 * picking a withdrawal destination, deriving an account, a background balance
 * refresh — and a DOM-only card would silently snap back to "Shield" with an
 * empty amount at that moment. Mirroring lets every rebuild restore what the
 * user had composed. The DOM stays the live value while typing, so no keystroke
 * triggers a render.
 */

import { STRK_TOKEN_ADDRESS, sameFelt } from "../starknet/networks";
import type { PrivacyJourneyState } from "./privacy-model";
import { maxPrivacyMove, projectPrivacyMove } from "./privacy-projection";

/**
 * State access the compose card needs. `setJourney` is called without a repaint:
 * these writes exist so a *later* rebuild can restore the card, not to drive one.
 */
export type ComposeCardDeps = {
  readonly app: Element | null;
  readonly journey: () => PrivacyJourneyState;
  readonly setJourney: (state: PrivacyJourneyState) => void;
};

// Reads the compose card's current direction-dependent numbers.
const composeContext = (form: HTMLFormElement, tokenAddress: string) => {
  const unshielding = form.dataset["direction"] === "unshield";
  return {
    decimals: Number(form.dataset["decimals"] ?? "18"),
    feeInSameToken: sameFelt(tokenAddress, STRK_TOKEN_ADDRESS),
    poolFeeFri: form.dataset["poolFee"],
    sourceBalanceRaw: unshielding
      ? (form.dataset["privateBalanceRaw"] ?? "0")
      : (form.dataset["publicBalance"] ?? "0"),
    symbol: form.dataset["symbol"] ?? "",
    unshielding,
  };
};

// Repaints the destination output and the fee sentence from the typed amount.
const paintProjection = (form: HTMLFormElement): void => {
  const input = form.querySelector<HTMLInputElement>("#privacy-amount");
  const output = form.querySelector<HTMLElement>("#privacy-result-amount");
  const feeNote = form.querySelector<HTMLElement>("[data-privacy-fee]");
  if (!input || !output) {
    return;
  }
  const context = composeContext(form, form.dataset["tokenAddress"] ?? "0x0");
  const projection = projectPrivacyMove({ ...context, amount: input.value });
  output.textContent = projection.received;
  if (feeNote) {
    feeNote.textContent = projection.feeNote;
    // A fee the user pays reads as neutral information, in the same muted style
    // every other fee line uses; only an unaffordable amount is alarming.
    feeNote.className = projection.feeTone === "warning" ? "swap-warning" : "review-fee";
    feeNote.toggleAttribute("hidden", projection.feeNote === "");
  }
};

// Repaints both panel labels and balance lines for the active direction.
const paintDirectionBoxes = (form: HTMLFormElement, unshielding: boolean): void => {
  const text = (selector: string, value: string): void => {
    const node = form.querySelector(selector);
    if (node) {
      node.textContent = value;
    }
  };
  const publicFormatted = form.dataset["publicFormatted"] ?? "0";
  const privateFormatted = form.dataset["privateFormatted"] ?? "0";
  text('[data-privacy-side-label="source"]', unshielding ? "Private balance" : "Public balance");
  text(
    '[data-privacy-side-label="destination"]',
    unshielding ? "Public balance" : "Private balance",
  );
  text('[data-privacy-side-balance="source"]', unshielding ? privateFormatted : publicFormatted);
  text(
    '[data-privacy-side-balance="destination"]',
    unshielding ? publicFormatted : privateFormatted,
  );
  const title = form.ownerDocument.querySelector(".flow-title h1");
  if (title) {
    title.textContent = unshielding ? "Unshield" : "Shield";
  }
};

// THE single place a direction is applied to the card, used both by the flip and
// by the restore that follows a rebuild — two implementations would drift.
const applyDirection = (
  form: HTMLFormElement,
  submit: HTMLButtonElement | null,
  unshielding: boolean,
): void => {
  const card = form;
  const action = submit;
  card.dataset["direction"] = unshielding ? "unshield" : "shield";
  paintDirectionBoxes(form, unshielding);
  paintProjection(form);
  if (action) {
    action.textContent = unshielding ? "Review unshielding" : "Review shielding";
  }
  // Unshield reveals the destination block; shielding always lands in this
  // account's own private balance, so there is nothing to address.
  form
    .querySelector<HTMLElement>("[data-privacy-recipient-row]")
    ?.toggleAttribute("hidden", !unshielding);
};

// Mirrors a composed field into journey state without repainting.
const remember = (
  deps: ComposeCardDeps,
  patch: { readonly amount?: string; readonly unshielding?: boolean },
): void => {
  const journey = deps.journey();
  if (journey.stage !== "compose") {
    return;
  }
  deps.setJourney({ ...journey, ...patch });
};

/**
 * Binds the compose card and restores whatever was composed before the last
 * rebuild. Safe to call on every paint; no-ops when the card is absent.
 */
export const bindComposeCard = (deps: ComposeCardDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#privacy-deposit-form");
  const input = deps.app?.querySelector<HTMLInputElement>("#privacy-amount");
  if (!form || !input) {
    return;
  }
  const submit = deps.app?.querySelector<HTMLButtonElement>("#privacy-review-submit") ?? null;
  const flip = deps.app?.querySelector<HTMLButtonElement>("#privacy-flip");
  const journey = deps.journey();
  const composed = journey.stage === "compose" ? journey : null;

  input.addEventListener("input", () => {
    paintProjection(form);
    remember(deps, { amount: input.value });
  });
  form.querySelectorAll<HTMLButtonElement>("[data-privacy-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = maxPrivacyMove(composeContext(form, form.dataset["tokenAddress"] ?? "0x0"));
      paintProjection(form);
      remember(deps, { amount: input.value });
    });
  });
  flip?.addEventListener("click", () => {
    const unshielding = form.dataset["direction"] !== "unshield";
    applyDirection(form, submit, unshielding);
    remember(deps, { unshielding });
  });

  // Restore order matters: the amount must be in the field before the direction
  // is applied, because applying it recomputes the projection from that amount.
  if (composed?.amount) {
    input.value = composed.amount;
  }
  if (composed?.unshielding) {
    applyDirection(form, submit, true);
    return;
  }
  paintProjection(form);
};
