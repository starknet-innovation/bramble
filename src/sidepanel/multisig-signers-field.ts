/**
 * DOM binding for the Multisig deployment signer picker. It mirrors selected
 * public addresses into one canonical form field; the background revalidates
 * signer count, felt shape, quorum, and deployment authority.
 */
import { isNonZeroStarkFieldElement, normalizeFeltInput, sameFelt } from "../starknet/networks";
import { accountLabel } from "./parts";

/**
 * Binds the staged signer picker to its hidden canonical signer field. Pasted
 * custom addresses are validated at this UI boundary; the background performs
 * the authoritative validation again before deployment.
 */
export const bindSignerPicker = (
  root: Element | null | undefined,
  signersField: HTMLInputElement | null | undefined,
): void => {
  const field = signersField;
  if (!root || !field) return;
  const form = field.closest<HTMLFormElement>("form");
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-signer-toggle]")];
  const selected = (): readonly string[] =>
    field.value.split(/[\s,]+/).filter((value) => value.length > 0);
  const has = (address: string): boolean => selected().some((value) => sameFelt(value, address));
  const labelFor = (address: string): string =>
    buttons.find((button) => sameFelt(button.dataset["signerToggle"] ?? "", address))?.dataset[
      "signerLabel"
    ] ?? "Custom signer";
  const sync = (notify: boolean): void => {
    const values = selected();
    for (const button of buttons) {
      const address = button.dataset["signerToggle"] ?? "";
      button.setAttribute("aria-pressed", String(has(address)));
    }
    const count = root.querySelector("#multisig-selected-count");
    if (count)
      count.textContent = `${values.length} signer${values.length === 1 ? "" : "s"} selected`;
    const continueButton = root.querySelector<HTMLButtonElement>("#multisig-signers-continue");
    if (continueButton) continueButton.disabled = values.length === 0;
    const quorum = form?.querySelector<HTMLInputElement>('input[name="quorum"]');
    if (quorum) {
      quorum.max = String(values.length);
      if (Number(quorum.value) > values.length) quorum.value = String(values.length);
    }
    const summary = root.querySelector("#multisig-selected-summary");
    if (summary) {
      summary.replaceChildren(
        ...values.map((address) => {
          const row = root.ownerDocument.createElement("div");
          const name = root.ownerDocument.createElement("strong");
          const code = root.ownerDocument.createElement("code");
          name.textContent = labelFor(address);
          code.textContent = accountLabel(address);
          row.append(name, code);
          return row;
        }),
      );
    }
    const view = field.ownerDocument.defaultView;
    if (notify && view) field.dispatchEvent(new view.Event("input", { bubbles: true }));
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const address = button.dataset["signerToggle"];
      if (!address) return;
      const values = has(address)
        ? selected().filter((value) => !sameFelt(value, address))
        : [...selected(), address];
      field.value = values.join("\n");
      sync(true);
    });
  }
  const search = root.querySelector<HTMLInputElement>("#multisig-signer-search");
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    for (const button of buttons) {
      button.hidden = !(button.dataset["signerSearch"] ?? "").includes(query);
    }
  });
  const custom = root.querySelector<HTMLInputElement>("#multisig-custom-signer");
  root
    .querySelector<HTMLButtonElement>("#multisig-custom-signer-add")
    ?.addEventListener("click", () => {
      const address = normalizeFeltInput(custom?.value ?? "");
      if (!custom || !isNonZeroStarkFieldElement(address)) {
        custom?.setCustomValidity("Enter a valid non-zero Starknet address");
        custom?.reportValidity();
        return;
      }
      custom.setCustomValidity("");
      if (!has(address)) field.value = [...selected(), address].join("\n");
      custom.value = "";
      sync(true);
    });
  const showStage = (stage: "rules" | "signers"): void => {
    for (const panel of root.querySelectorAll<HTMLElement>("[data-deploy-stage]")) {
      panel.hidden = panel.dataset["deployStage"] !== stage;
    }
    if (form) form.dataset["stage"] = stage;
  };
  root
    .querySelector<HTMLButtonElement>("#multisig-signers-continue")
    ?.addEventListener("click", () => showStage("rules"));
  root
    .querySelector<HTMLButtonElement>("#multisig-signers-back")
    ?.addEventListener("click", () => showStage("signers"));
  sync(false);
};
