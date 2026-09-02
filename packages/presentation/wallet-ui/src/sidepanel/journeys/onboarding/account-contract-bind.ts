/** Account-contract choice bindings shared by software and first-run Ledger setup. */

import { isAccountContractType } from "@bramble/wallet-model/accounts";

type AccountContractChoiceDeps = {
  readonly app: Element | null;
  readonly form: HTMLFormElement;
  readonly onLedgerContinue: () => void;
  readonly onSoftwareChange: () => void;
};

const selectChoice = (root: Element, selector: string, selected: HTMLButtonElement): void => {
  root.querySelectorAll<HTMLButtonElement>(selector).forEach((option) => {
    option.setAttribute("aria-pressed", String(option === selected));
  });
};

/**
 * Keeps the two visual contract pickers synchronized with their hidden,
 * validated form values. Software changes invalidate the derived preview;
 * Ledger changes carry into the separate local-registry protection step.
 */
export const bindAccountContractChoices = ({
  app,
  form,
  onLedgerContinue,
  onSoftwareChange,
}: AccountContractChoiceDeps): void => {
  const softwareInput = form.querySelector<HTMLInputElement>('input[name="accountContractType"]');
  const review = form.querySelector<HTMLButtonElement>("#review-account-button");
  form.querySelectorAll<HTMLButtonElement>("[data-account-contract]").forEach((button) => {
    button.addEventListener("click", () => {
      const contractType = button.dataset["accountContract"];
      if (!isAccountContractType(contractType) || !softwareInput) return;
      softwareInput.value = contractType;
      selectChoice(form, "[data-account-contract]", button);
      review?.lastChild?.replaceWith(
        contractType === "argent" ? "Review Ready account" : "Review Bramble account",
      );
      onSoftwareChange();
    });
  });

  const ledgerInput = app?.querySelector<HTMLInputElement>(
    'input[name="ledgerAccountContractType"]',
  );
  const ledgerContinue = app?.querySelector<HTMLButtonElement>("#ledger-contract-continue");
  app?.querySelectorAll<HTMLButtonElement>("[data-ledger-account-contract]").forEach((button) => {
    button.addEventListener("click", () => {
      const contractType = button.dataset["ledgerAccountContract"];
      if (!isAccountContractType(contractType) || !ledgerInput || !app) return;
      ledgerInput.value = contractType;
      selectChoice(app, "[data-ledger-account-contract]", button);
      ledgerContinue?.lastChild?.replaceWith(
        contractType === "argent" ? "Continue with Ready account" : "Continue with Bramble account",
      );
    });
  });
  ledgerContinue?.addEventListener("click", onLedgerContinue);
};
