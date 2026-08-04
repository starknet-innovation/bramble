/**
 * Private-send toggle for the Send screen. The toggle is enabled only when
 * every blocker clears: shielded balances discovered, sender registered,
 * non-zero private balance of the selected token, a valid recipient, and the
 * recipient registered with the privacy pool (checked automatically, cached
 * per address). While on, the balance shown and used by Max/Half is the
 * private balance; turning it off restores the public figures.
 */

import { isStarkFieldElement, normalizeFeltInput } from "../starknet/networks";
import type { PrivacyDisclosureState } from "./privacy-model";
import type { SidepanelWallet } from "./runtime";
import { compactAmount } from "./token-row";
import { sendFormInput } from "./transfer-compose-ui";

const RECIPIENT_CHECK_DEBOUNCE_MS = 400;

type RecipientRegistration = "checking" | "registered" | "unregistered";

/**
 * Collaborators for the private-send toggle bindings.
 */
export type PrivateSendUiDeps = {
  readonly form: HTMLFormElement;
  readonly onModeChange: () => void;
  readonly privacy: () => PrivacyDisclosureState;
  readonly wallet: SidepanelWallet;
};

const blockerReason = (
  deps: PrivateSendUiDeps,
  recipient: string,
  recipientStatus: RecipientRegistration | null,
): string | null => {
  const disclosure = deps.privacy();
  if (disclosure.error) {
    return "Shielded balances are unavailable right now";
  }
  if (disclosure.loading || !disclosure.value) {
    return "Discovering shielded balances…";
  }
  if (disclosure.value.registration !== "registered") {
    return "Activate private balances before sending privately";
  }
  const tokenId = sendFormInput(deps.form, "tokenId")?.value ?? "";
  const entry = disclosure.value.balances.find((balance) => balance.tokenId === tokenId);
  if (!entry || BigInt(entry.balance) === 0n) {
    return "No private balance of this asset yet";
  }
  if (!recipient || !isStarkFieldElement(recipient)) {
    return "Choose a recipient first";
  }
  if (recipientStatus === "checking" || recipientStatus === null) {
    return "Checking the recipient's privacy registration…";
  }
  if (recipientStatus === "unregistered") {
    return "The recipient has not activated private balances";
  }
  return null;
};

const setBalanceDisplay = (form: HTMLFormElement, formatted: string, symbol: string): void => {
  const label = form.querySelector<HTMLElement>("#send-balance-label");
  if (label) {
    label.textContent = `Balance ${compactAmount(formatted)} ${symbol}`;
  }
};

/**
 * Binds the Send screen's private toggle: gating with a hover reason, the
 * debounced recipient registration check, and the public/private swap of the
 * balance used for display, Max, and Half.
 */
export const bindPrivateSendToggle = (deps: PrivateSendUiDeps): void => {
  const { form } = deps;
  const toggle = form.querySelector<HTMLInputElement>("#send-private-checkbox");
  const container = form.querySelector<HTMLElement>("#send-private-toggle");
  const flag = sendFormInput(form, "privateSend");
  if (!toggle || !container || !flag) {
    return;
  }
  const recipientChecks = new Map<string, RecipientRegistration>();
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let publicBalanceStash: { readonly balance: string; readonly formatted: string } | null = null;

  const currentRecipient = (): string =>
    normalizeFeltInput(sendFormInput(form, "recipient")?.value ?? "");

  const disablePrivateMode = (): void => {
    if (flag.value !== "1") {
      return;
    }
    flag.value = "";
    toggle.checked = false;
    const balanceInput = sendFormInput(form, "tokenBalance");
    const formattedInput = sendFormInput(form, "tokenFormatted");
    if (publicBalanceStash && balanceInput && formattedInput) {
      balanceInput.value = publicBalanceStash.balance;
      formattedInput.value = publicBalanceStash.formatted;
      setBalanceDisplay(
        form,
        publicBalanceStash.formatted,
        sendFormInput(form, "tokenSymbol")?.value ?? "",
      );
    }
    publicBalanceStash = null;
    deps.onModeChange();
  };

  const enablePrivateMode = (): void => {
    const tokenId = sendFormInput(form, "tokenId")?.value ?? "";
    const entry = deps.privacy().value?.balances.find((balance) => balance.tokenId === tokenId);
    const balanceInput = sendFormInput(form, "tokenBalance");
    const formattedInput = sendFormInput(form, "tokenFormatted");
    if (!entry || !balanceInput || !formattedInput) {
      toggle.checked = false;
      return;
    }
    publicBalanceStash = { balance: balanceInput.value, formatted: formattedInput.value };
    flag.value = "1";
    balanceInput.value = BigInt(entry.balance).toString(10);
    formattedInput.value = entry.formatted;
    setBalanceDisplay(form, entry.formatted, sendFormInput(form, "tokenSymbol")?.value ?? "");
    deps.onModeChange();
  };

  const evaluate = (): void => {
    const recipient = currentRecipient();
    const status = recipient ? (recipientChecks.get(recipient) ?? null) : null;
    const reason = blockerReason(deps, recipient, status);
    toggle.disabled = reason !== null;
    container.title = reason ?? "Send from your private balance to the recipient's";
    container.classList.toggle("muted", reason !== null);
    if (reason !== null && flag.value === "1") {
      disablePrivateMode();
    }
    if (
      recipient &&
      isStarkFieldElement(recipient) &&
      !recipientChecks.has(recipient) &&
      deps.privacy().value?.registration === "registered"
    ) {
      recipientChecks.set(recipient, "checking");
      if (checkTimer !== null) {
        clearTimeout(checkTimer);
      }
      checkTimer = setTimeout(() => {
        const tokenId = sendFormInput(form, "tokenId")?.value ?? "";
        void deps.wallet.loadPrivacyRecipientStatus(tokenId, recipient).then(
          (registration) => {
            recipientChecks.set(recipient, registration);
            evaluate();
          },
          () => {
            recipientChecks.delete(recipient);
            evaluate();
          },
        );
      }, RECIPIENT_CHECK_DEBOUNCE_MS);
    }
  };

  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      enablePrivateMode();
    } else {
      disablePrivateMode();
    }
  });
  // Recipient edits, asset switches, and stage moves all surface as input or
  // click activity on the form; re-evaluating is cheap and idempotent.
  form.addEventListener("input", evaluate);
  form.addEventListener("click", () => evaluate());
  evaluate();
};
