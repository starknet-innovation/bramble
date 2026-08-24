/** Compact deployment-signer disclosure binding. */

const copyChildren = (source: Element, target: Element): void => {
  target.replaceChildren(...[...source.childNodes].map((child) => child.cloneNode(true)));
};

/**
 * Keeps the compact signer summary aligned with the selected trusted account row.
 */
export const bindDeploymentSignerPicker = (
  form: HTMLFormElement,
  signerAccountInput: HTMLInputElement | undefined,
  notifyInput: (input: HTMLInputElement) => void,
): ((choice: HTMLButtonElement | undefined) => void) => {
  const targetInput = signerAccountInput;
  const picker = form.querySelector<HTMLDetailsElement>("[data-deployment-signer-picker]");
  const avatar = picker?.querySelector<HTMLElement>("[data-deployment-signer-current-avatar]");
  const copy = picker?.querySelector<HTMLElement>("[data-deployment-signer-current-copy]");
  const sync = (choice: HTMLButtonElement | undefined): void => {
    const nextAvatar = choice?.querySelector(".option-avatar");
    const nextCopy = choice?.querySelector(".option-copy");
    avatar?.toggleAttribute("hidden", !nextAvatar);
    if (avatar && nextAvatar) copyChildren(nextAvatar, avatar);
    if (copy && nextCopy) copyChildren(nextCopy, copy);
    else if (copy) copy.textContent = "No local signer available";
  };
  form.querySelectorAll<HTMLButtonElement>("[data-deployment-signer]").forEach((choice) => {
    choice.addEventListener("click", () => {
      const accountId = choice.dataset["deploymentSigner"];
      if (choice.hidden || !accountId || !targetInput) return;
      const changed = targetInput.value !== accountId;
      targetInput.value = accountId;
      form.querySelectorAll<HTMLButtonElement>("[data-deployment-signer]").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === choice));
      });
      sync(choice);
      picker?.removeAttribute("open");
      picker?.querySelector<HTMLElement>("summary")?.focus();
      if (changed) notifyInput(targetInput);
    });
  });
  return sync;
};
