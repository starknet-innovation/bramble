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

import type { SendRouteResolution, ValueBucket } from "../starknet/send-routes";
import { compactAmount } from "./token-row";
import { sendFormInput } from "./transfer-compose-ui";

/**
 * Collaborators for the bucket controls.
 */
export type TransferBucketsDeps = {
  readonly form: HTMLFormElement;
  /** Re-reads fields and drops any cached review after a bucket flip. */
  readonly onRouteChange: () => void;
  /** The formatted balance and raw value held in one bucket, for display. */
  readonly balanceIn: (bucket: ValueBucket) => { readonly formatted: string; readonly raw: string };
  readonly route: () => SendRouteResolution;
};

const LABELS: Readonly<Record<ValueBucket, string>> = {
  private: "Private",
  public: "Public",
};

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
  const container = form.querySelector<HTMLElement>("#send-route-controls");

  const showBalance = (): void => {
    const source = readBucket(form, "source");
    const balance = deps.balanceIn(source);
    const symbol = sendFormInput(form, "tokenSymbol")?.value ?? "";
    // The amount field measures against the bucket being spent from, so the
    // label and the raw value Max reads must both follow the source.
    const balanceField = sendFormInput(form, "tokenBalance");
    const formattedField = sendFormInput(form, "tokenFormatted");
    if (balanceField) balanceField.value = balance.raw;
    if (formattedField) formattedField.value = balance.formatted;
    const label = form.querySelector<HTMLElement>("#send-balance-label");
    if (label) {
      const scope = source === "private" ? "Private balance" : "Balance";
      label.textContent = `${scope} ${compactAmount(balance.formatted)} ${symbol}`;
    }
  };

  const applyGate = (): void => {
    const view = deps.route();
    for (const button of form.querySelectorAll<HTMLButtonElement>("[data-send-bucket]")) {
      const name = button.dataset["sendBucket"] === "destination" ? "destination" : "source";
      const value = button.dataset["sendBucketValue"] === "private" ? "private" : "public";
      button.setAttribute("aria-pressed", String(readBucket(form, name) === value));
      button.textContent = LABELS[value];
    }
    container?.classList.toggle("muted", view.blocked !== undefined);
    container?.setAttribute("title", view.blocked?.reason ?? "Choose where the value moves");
    if (reason) {
      // Spelled out beside the controls: a disabled action whose only
      // explanation was a title tooltip read as a broken control.
      reason.textContent = view.blocked?.reason ?? "";
      reason.hidden = view.blocked === undefined;
    }
  };

  const choose = (name: "destination" | "source", value: ValueBucket): void => {
    if (readBucket(form, name) === value) {
      return;
    }
    setBucket(form, name, value);
    showBalance();
    deps.onRouteChange();
    applyGate();
  };

  for (const button of form.querySelectorAll<HTMLButtonElement>("[data-send-bucket]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const name = button.dataset["sendBucket"] === "destination" ? "destination" : "source";
      choose(name, button.dataset["sendBucketValue"] === "private" ? "private" : "public");
    });
  }

  // Recipient edits, asset switches, and stage moves all surface as input or
  // click activity on the form; re-gating is cheap and idempotent.
  form.addEventListener("input", applyGate);
  form.addEventListener("click", () => applyGate());
  showBalance();
  applyGate();
};
