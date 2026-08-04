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

// A blocker either forbids private mode outright (`pending: false`) or is only
// an in-flight check. A pending check must not switch an already-enabled
// private mode back off — a repaint re-checks the recipient, and reverting
// there would silently turn a reviewed private send public.
type Blocker = { readonly pending: boolean; readonly reason: string };

const blockerReason = (
  deps: PrivateSendUiDeps,
  recipient: string,
  recipientStatus: RecipientRegistration | null,
): Blocker | null => {
  const disclosure = deps.privacy();
  if (disclosure.error) {
    return { pending: false, reason: "Shielded balances are unavailable right now" };
  }
  if (disclosure.loading || !disclosure.value) {
    return { pending: true, reason: "Discovering shielded balances…" };
  }
  if (disclosure.value.registration !== "registered") {
    return { pending: false, reason: "Activate private balances before sending privately" };
  }
  const tokenId = sendFormInput(deps.form, "tokenId")?.value ?? "";
  const entry = disclosure.value.balances.find((balance) => balance.tokenId === tokenId);
  if (!entry || BigInt(entry.balance) === 0n) {
    return { pending: false, reason: "No private balance of this asset yet" };
  }
  if (!recipient || !isStarkFieldElement(recipient)) {
    return { pending: false, reason: "Choose a recipient first" };
  }
  if (recipientStatus === "checking" || recipientStatus === null) {
    return { pending: true, reason: "Checking the recipient's privacy registration…" };
  }
  if (recipientStatus === "unregistered") {
    return { pending: false, reason: "The recipient has not activated private balances" };
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

  const currentRecipient = (): string =>
    normalizeFeltInput(sendFormInput(form, "recipient")?.value ?? "");

  const applyBalance = (raw: string, formatted: string): void => {
    const balanceInput = sendFormInput(form, "tokenBalance");
    const formattedInput = sendFormInput(form, "tokenFormatted");
    if (!balanceInput || !formattedInput) {
      return;
    }
    balanceInput.value = raw;
    formattedInput.value = formatted;
    setBalanceDisplay(form, formatted, sendFormInput(form, "tokenSymbol")?.value ?? "");
  };

  const disablePrivateMode = (notify = true): void => {
    flag.value = "";
    toggle.checked = false;
    // The public balance rides on the form, re-rendered from the asset on every
    // repaint, so restoring it never depends on in-memory state.
    applyBalance(form.dataset["publicBalance"] ?? "0", form.dataset["publicFormatted"] ?? "0");
    if (notify) {
      deps.onModeChange();
    }
  };

  const enablePrivateMode = (notify = true): void => {
    const tokenId = sendFormInput(form, "tokenId")?.value ?? "";
    const entry = deps.privacy().value?.balances.find((balance) => balance.tokenId === tokenId);
    if (!entry) {
      toggle.checked = false;
      flag.value = "";
      return;
    }
    flag.value = "1";
    toggle.checked = true;
    applyBalance(BigInt(entry.balance).toString(10), entry.formatted);
    if (notify) {
      deps.onModeChange();
    }
  };

  const evaluate = (): void => {
    const recipient = currentRecipient();
    const status = recipient ? (recipientChecks.get(recipient) ?? null) : null;
    const blocker = blockerReason(deps, recipient, status);
    toggle.disabled = blocker !== null;
    container.title = blocker?.reason ?? "Send from your private balance to the recipient's";
    container.classList.toggle("muted", blocker !== null);
    if (blocker !== null && !blocker.pending && flag.value === "1") {
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
        // Drop the superseded in-flight marker so an abandoned address is not
        // left stuck on "checking" if the user comes back to it.
        clearTimeout(checkTimer);
        for (const [address, state] of recipientChecks) {
          if (state === "checking" && address !== recipient) {
            recipientChecks.delete(address);
          }
        }
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
  // A shell repaint re-renders the form from the asset's public balance while
  // the restored flag still says private, so re-apply the private view (or
  // clear a flag whose private balance is gone) before the first evaluate.
  if (flag.value === "1") {
    enablePrivateMode(false);
  }
  evaluate();
};
