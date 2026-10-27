/**
 * Remembers the fee-token button a send review was submitted with.
 *
 * The click is untrusted DOM data. Only a send-form button is read; an
 * approval card's button carries its own id and is ignored. The choice is
 * cleared on the next submit so a later send cannot reuse it.
 */

import type { GaslessFeeOffer } from "@bramble/privacy/gasless-request";

/**
 * Binds the send form's fee-token buttons. `take` returns the choice once.
 */
export const bindGaslessFeeChoice = (
  form: HTMLFormElement,
): { readonly take: () => GaslessFeeOffer | undefined } => {
  let choice: GaslessFeeOffer | undefined;
  form.addEventListener("click", (event) => {
    const target = event.target;
    const button =
      target instanceof Element ? target.closest<HTMLButtonElement>("[data-gasless-token]") : null;
    if (!button?.dataset["gaslessToken"] || button.dataset["approvalId"]) {
      return;
    }
    const amount = button.dataset["gaslessAmount"];
    const label = button.dataset["gaslessLabel"];
    const decimalsText = button.dataset["gaslessDecimals"];
    const tokenAddress = button.dataset["gaslessToken"];
    if (!amount || !label || !decimalsText || !tokenAddress) {
      return;
    }
    const decimals = Number(decimalsText);
    if (!Number.isInteger(decimals)) {
      return;
    }
    choice = { amount, decimals, label, tokenAddress };
    form.requestSubmit();
  });
  return {
    take: () => {
      const chosen = choice;
      choice = undefined;
      return chosen;
    },
  };
};
