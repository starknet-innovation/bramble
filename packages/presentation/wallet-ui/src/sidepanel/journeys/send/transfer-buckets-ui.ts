/**
 * Source and destination bucket controls on the Send amount card.
 *
 * Sending is one operation over two buckets: spending from a public or private
 * balance, into a public or private one. Shielding and unshielding are two of
 * the four combinations, so this replaces the old private-only checkbox with the
 * pair that names the route. The buckets live in hidden form fields rather than
 * in the control's own state, because a repaint rebuilds the card and a
 * DOM-only choice would snap back mid-edit.
 *
 * Gating comes from the shared route resolver, so the panel and the background
 * refuse for the same reasons, and the reason is rendered next to the control
 * rather than only as a hover title.
 */

import type { SendRouteResolution, ValueBucket } from "@bramble/transactions/send-routes";
import { compactAmount } from "../portfolio/token-row";
import { sendFormInput } from "./transfer-compose-ui";

/**
 * Collaborators for the bucket controls.
 */
export type TransferBucketsDeps = {
  readonly form: HTMLFormElement;
  /** Re-reads fields and drops any cached review after a bucket flip. */
  readonly onRouteChange: () => void;
  /** Re-runs privacy discovery after a recoverable account-state failure. */
  readonly retry?: () => void;
  readonly retryable?: () => boolean;
  /** The formatted balance and raw value held in one bucket, for display. */
  readonly balanceIn: (bucket: ValueBucket) => {
    readonly formatted: string | null;
    readonly raw: string | null;
  };
  readonly route: () => SendRouteResolution;
};

const LABELS: Readonly<Record<ValueBucket, string>> = {
  private: "Private",
  public: "Public",
};

// The button states which balance is in use; its title states what pressing it
// does, since a self-labelling toggle cannot show both at once.
const HINTS: Readonly<Record<ValueBucket, string>> = {
  private: "Switch to the public balance",
  public: "Switch to the private balance",
};

const legOf = (button: HTMLButtonElement): "destination" | "source" =>
  button.dataset["sendBucket"] === "destination" ? "destination" : "source";

const setBucket = (form: HTMLFormElement, name: "destination" | "source", value: ValueBucket) => {
  const field = sendFormInput(form, name);
  if (field) {
    field.value = value;
  }
};

const readBucket = (form: HTMLFormElement, name: "destination" | "source"): ValueBucket =>
  sendFormInput(form, name)?.value === "private" ? "private" : "public";

/**
 * Binds the bucket pair: the controls that set them, the balance the amount
 * field measures against, and the gate that reports why a route is unavailable.
 */
export const bindTransferBuckets = (deps: TransferBucketsDeps): void => {
  const { form } = deps;
  const reason = form.querySelector<HTMLElement>("#send-route-reason");
  const retry = form.querySelector<HTMLButtonElement>("#send-route-retry");
  const container = form.querySelector<HTMLElement>("#send-route-controls");

  const showBalance = (): void => {
    const source = readBucket(form, "source");
    const balance = deps.balanceIn(source);
    const symbol = sendFormInput(form, "tokenSymbol")?.value ?? "";
    // The amount field measures against the bucket being spent from, so the
    // label and the raw value Max reads must both follow the source.
    const balanceField = sendFormInput(form, "tokenBalance");
    const formattedField = sendFormInput(form, "tokenFormatted");
    if (balanceField) balanceField.value = balance.raw ?? "";
    if (formattedField) formattedField.value = balance.formatted ?? "";
    const label = form.querySelector<HTMLElement>("#send-balance-label");
    if (label) {
      const scope = source === "private" ? "Private balance" : "Balance";
      label.textContent =
        balance.formatted === null
          ? `${scope} unavailable`
          : `${scope} ${compactAmount(balance.formatted)} ${symbol}`;
    }
  };

  const applyGate = (): void => {
    const view = deps.route();
    const incomplete = !(sendFormInput(form, "amount")?.value.trim() ?? "");
    const blocked = incomplete ? undefined : view.blocked;
    for (const button of form.querySelectorAll<HTMLButtonElement>("[data-send-bucket]")) {
      const bucket = readBucket(form, legOf(button));
      button.textContent = LABELS[bucket];
      button.dataset["bucket"] = bucket;
      button.title = HINTS[bucket];
    }
    container?.classList.toggle("muted", blocked !== undefined);
    container?.setAttribute("title", blocked?.reason ?? "Choose where the value moves");
    if (reason) {
      // Spelled out beside the controls: a disabled action whose only
      // explanation was a title tooltip read as a broken control.
      reason.textContent = blocked?.reason ?? "";
      reason.hidden = blocked === undefined;
    }
    if (retry) {
      retry.hidden = blocked === undefined || deps.retryable?.() !== true;
    }
  };

  const flip = (name: "destination" | "source"): void => {
    setBucket(form, name, readBucket(form, name) === "private" ? "public" : "private");
    showBalance();
    deps.onRouteChange();
    applyGate();
  };

  for (const button of form.querySelectorAll<HTMLButtonElement>("[data-send-bucket]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      flip(legOf(button));
    });
  }
  retry?.addEventListener("click", () => deps.retry?.());

  // Recipient edits, asset switches, and stage moves all surface as input or
  // click activity on the form; re-gating is cheap and idempotent.
  form.addEventListener("input", applyGate);
  form.addEventListener("click", () => applyGate());
  showBalance();
  applyGate();
};
