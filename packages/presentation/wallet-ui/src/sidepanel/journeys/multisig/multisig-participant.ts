/** Shared participant picker for multisig setup and signer management. */
import { escapeHtml } from "@bramble/core/html";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { inputControl, textareaField } from "@bramble/ui-kit/fields";
import { icon } from "@bramble/ui-kit/icons";
import { isNonZeroStarkFieldElement, normalizeFeltInput } from "@bramble/wallet-model/networks";
import { parseWalletContactCard } from "@bramble/wallet-model/preferences";
import { t, th } from "../../../i18n/messages";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, errorLine, errorMessage, showToast } from "../../shared/dom";
import { accountAvatar, accountLabel } from "../../shared/parts";
import type { MultisigClient } from "./multisig-runtime";

/**
 * Validated public participant metadata used only after explicit user selection.
 */
export type MultisigParticipant = {
  readonly address?: string;
  readonly label: string;
  readonly nostrPublicKey?: string;
  readonly publicKeyX: string;
  readonly source: string;
};

/**
 * Public local-wallet or address-book identity safe to offer without an RPC read.
 */
export type MultisigParticipantOption = MultisigParticipant & { readonly address: string };

const knownParticipant = ({
  address,
  label,
  publicKeyX,
  source,
}: MultisigParticipantOption): string => `
  <button class="option-row multisig-participant-option" data-participant-address="${escapeHtml(address)}" data-participant-key="${escapeHtml(publicKeyX)}" data-participant-label="${escapeHtml(label)}" data-participant-source="${escapeHtml(source)}" type="button">
    <span class="option-avatar">${accountAvatar(address)}</span>
    <span class="option-copy">
      <strong>${escapeHtml(label)}</strong>
      <code>${escapeHtml(accountLabel(address))}</code>
      <span class="option-sub">${escapeHtml(source)} · ${th("multisig.participant.key", { key: accountLabel(publicKeyX) })}</span>
    </span>
    <span class="option-mark">${icon("plus")}</span>
  </button>`;

/**
 * Renders the in-journey participant screen. It stays inside the originating
 * form so Back preserves every signer, threshold, and deployment field.
 */
export const multisigParticipantScreen = (
  networkId: string,
  options: readonly MultisigParticipantOption[],
): string => `
  <section class="multisig-participant-screen" data-participant-network="${escapeHtml(networkId)}" data-participant-screen hidden>
    <header class="multisig-participant-head">
      ${iconButton({ attributes: { "data-close-participant-picker": true }, icon: "chevronLeft", label: t("multisig.participant.back"), variant: "ghost" })}
      <div><h2>${th("multisig.signers.addParticipant")}</h2><p>${th("multisig.participant.lede")}</p></div>
    </header>
    ${
      options.length > 0
        ? `<details class="disclosure multisig-participant-known">
            <summary><span class="menu-copy"><strong>${th("multisig.participant.chooseKnown")}</strong><small>${th("multisig.participant.knownCount", { count: String(options.length) })}</small></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
            <div class="disclosure-body"><div class="option-list" role="list">${options.map(knownParticipant).join("")}</div></div>
          </details>`
        : ""
    }
    <div class="multisig-participant-external">
      <h3>${options.length > 0 ? th("multisig.participant.someoneElse") : th("multisig.participant.details")}</h3>
      <div class="multisig-participant-methods" role="group" aria-label="${th("multisig.participant.methodType")}">
        <button data-participant-method="address" type="button" aria-pressed="true">
          <span>${icon("wallet")}</span><strong>${th("multisig.signers.address")}</strong><small>${th("multisig.participant.lookUpKey")}</small>
        </button>
        <button data-participant-method="public-key" type="button" aria-pressed="false">
          <span>${icon("link")}</span><strong>${th("multisig.participant.publicKey")}</strong><small>${th("multisig.participant.useSharedKey")}</small>
        </button>
        <button data-participant-method="wallet-card" type="button" aria-pressed="false">
          <span>${icon("qrCode")}</span><strong>${th("multisig.participant.walletCard")}</strong><small>${th("multisig.participant.addFullContact")}</small>
        </button>
      </div>
      <div data-participant-field="address">
        <label><span>${th("multisig.participant.addressLabel")}</span>${inputControl({ ariaLabel: t("multisig.participant.addressLabel"), attributes: { "data-participant-address-input": true }, autocapitalize: "none", className: "mono", placeholder: "0x…", spellcheck: false })}</label>
        <p class="hint">${th("multisig.participant.addressHint")}</p>
      </div>
      <div data-participant-field="public-key" hidden>
        <label><span>${th("multisig.participant.keyLabel")}</span>${inputControl({ ariaLabel: t("multisig.participant.keyLabel"), attributes: { "data-participant-key-input": true }, autocapitalize: "none", className: "mono", placeholder: "0x…", spellcheck: false })}</label>
        <p class="hint">${th("multisig.participant.keyHint")}</p>
      </div>
      <div data-participant-field="wallet-card" hidden>
        <label><span>${th("multisig.participant.name")}</span>${inputControl({ ariaLabel: t("multisig.participant.name"), attributes: { "data-participant-label-input": true }, autocomplete: "off", placeholder: t("multisig.participant.namePlaceholder") })}</label>
        ${textareaField({ className: "mono", label: t("multisig.participant.sharedCard"), name: "participantWalletCard", placeholder: "mcw:contact:1:…", rows: 4, spellcheck: false })}
        <p class="hint">${th("multisig.participant.cardHint")}</p>
      </div>
      ${button({ attributes: { "data-confirm-participant": true }, label: t("multisig.participant.findKey") })}
      <p data-participant-result role="status" aria-live="polite"></p>
    </div>
  </section>`;

/**
 * Runtime lookup and origin-owned selection gate; either may reject the participant.
 */
export type MultisigParticipantPickerDeps = {
  readonly multisig: Pick<MultisigClient, "resolveSigner">;
  readonly onSelect: (participant: MultisigParticipant) => string | null;
  /** Takes back a selection `onSelect` made, when the contact save after it fails. */
  readonly onUnselect: (participant: MultisigParticipant) => void;
  readonly saveContact?: (participant: WalletCardParticipant) => Promise<void>;
};

/** A wallet-card participant: the only kind the picker saves as a contact. */
type WalletCardParticipant = MultisigParticipant & {
  readonly address: string;
  readonly nostrPublicKey: string;
};

/**
 * Saves a wallet-card participant to the address book, on the network of the
 * picker found inside `scope`.
 */
export const participantContactSaver =
  (wallet: Pick<SidepanelWallet, "saveAddress">, scope: HTMLElement | null | undefined) =>
  (participant: WalletCardParticipant): Promise<void> =>
    wallet.saveAddress(
      participant.label,
      participant.address,
      scope?.querySelector<HTMLElement>("[data-participant-network]")?.dataset[
        "participantNetwork"
      ] ?? "",
      participant.publicKeyX,
      participant.nostrPublicKey,
    );

/**
 * Binds one picker, validates all manual input, and restores focus/state to its origin.
 */
export const bindMultisigParticipantPicker = (
  root: HTMLElement,
  deps: MultisigParticipantPickerDeps,
): void => {
  const origin = root.querySelector<HTMLElement>("[data-participant-origin]");
  const screen = root.querySelector<HTMLElement>("[data-participant-screen]");
  const open = root.querySelector<HTMLButtonElement>("[data-open-participant-picker]");
  const confirm = screen?.querySelector<HTMLButtonElement>("[data-confirm-participant]");
  const addressInput = screen?.querySelector<HTMLInputElement>("[data-participant-address-input]");
  const publicKeyInput = screen?.querySelector<HTMLInputElement>("[data-participant-key-input]");
  const labelInput = screen?.querySelector<HTMLInputElement>("[data-participant-label-input]");
  const walletCardInput = screen?.querySelector<HTMLTextAreaElement>(
    '[name="participantWalletCard"]',
  );
  const result = screen?.querySelector<HTMLElement>("[data-participant-result]");
  if (!origin || !screen || !open || !confirm || !addressInput || !publicKeyInput || !result)
    return;
  let method: "address" | "public-key" | "wallet-card" = "address";

  const close = (): void => {
    screen.hidden = true;
    origin.hidden = false;
    open.focus({ preventScroll: true });
  };
  const accept = (participant: MultisigParticipant): boolean => {
    const selectionError = deps.onSelect(participant);
    if (selectionError) {
      result.textContent = selectionError;
      showToast(selectionError, "error", confirm);
      return false;
    }
    return true;
  };
  const complete = (): void => {
    addressInput.value = "";
    publicKeyInput.value = "";
    if (labelInput) labelInput.value = "";
    if (walletCardInput) walletCardInput.value = "";
    result.textContent = "";
    close();
  };
  const finish = (participant: MultisigParticipant): boolean => {
    if (!accept(participant)) return false;
    complete();
    return true;
  };
  const selectMethod = (next: typeof method): void => {
    method = next;
    screen.querySelectorAll<HTMLButtonElement>("[data-participant-method]").forEach((control) => {
      control.setAttribute("aria-pressed", String(control.dataset["participantMethod"] === method));
    });
    screen.querySelectorAll<HTMLElement>("[data-participant-field]").forEach((field) => {
      const targetField = field;
      targetField.hidden = field.dataset["participantField"] !== method;
    });
    confirm.textContent =
      method === "address"
        ? t("multisig.participant.findKey")
        : method === "wallet-card"
          ? t("multisig.signers.addParticipant")
          : t("multisig.participant.addKey");
    result.textContent = "";
    (method === "address"
      ? addressInput
      : method === "wallet-card"
        ? labelInput
        : publicKeyInput
    )?.focus({ preventScroll: true });
  };
  const submitWalletCard = async (): Promise<void> => {
    const card = parseWalletContactCard(walletCardInput?.value.trim() ?? "");
    const label = labelInput?.value.trim() ?? "";
    const message = !card
      ? t("multisig.participant.invalidCard")
      : card.networkId !== screen.dataset["participantNetwork"]
        ? t("multisig.participant.otherNetwork")
        : !card.publicKeyX || !card.nostrPublicKey
          ? t("multisig.participant.askFullCard")
          : label.length === 0 || label.length > 64
            ? t("multisig.participant.nameLength")
            : null;
    if (message || !card?.publicKeyX || !card.nostrPublicKey) {
      result.textContent = message ?? t("multisig.participant.cardIncomplete");
      showToast(result.textContent, "error", walletCardInput ?? confirm);
      return;
    }
    const participant = {
      address: card.address,
      label,
      nostrPublicKey: card.nostrPublicKey,
      publicKeyX: card.publicKeyX,
      source: t("multisig.participant.walletCard"),
    } as const;
    buttonBusy(confirm, true);
    try {
      if (!accept(participant)) return;
      // Selection runs first so a card the flow refuses is never saved. A save
      // the address book refuses, such as a card whose keys differ from a saved
      // contact's (Sherlock 258), takes the selection back: otherwise the card's
      // keys would join the signer set while the screen reports the refusal.
      await deps.saveContact?.(participant).catch((error: unknown) => {
        deps.onUnselect(participant);
        throw error;
      });
      complete();
    } catch (error) {
      const fallback = t("multisig.participant.saveFailed");
      const failure = errorMessage(error, fallback);
      result.textContent = errorLine(error, fallback);
      showToast(failure, "error", confirm, errorDetails(error, fallback));
    } finally {
      buttonBusy(confirm, false);
    }
  };
  const submitPublicKey = async (): Promise<void> => {
    const publicKeyX = normalizeFeltInput(publicKeyInput.value);
    if (!isNonZeroStarkFieldElement(publicKeyX)) {
      result.textContent = t("multisig.participant.invalidKey");
      showToast(result.textContent, "error", publicKeyInput);
      publicKeyInput.focus();
      return;
    }
    finish({
      label: t("multisig.participant.signerLabel", { key: accountLabel(publicKeyX) }),
      publicKeyX,
      source: t("multisig.participant.sharedKey"),
    });
  };
  const submitAddress = async (): Promise<void> => {
    const address = normalizeFeltInput(addressInput.value);
    if (!isNonZeroStarkFieldElement(address)) {
      result.textContent = t("multisig.participant.invalidAddress");
      showToast(result.textContent, "error", addressInput);
      addressInput.focus();
      return;
    }
    buttonBusy(confirm, true);
    result.textContent = t("multisig.participant.checking");
    try {
      const signer = await deps.multisig.resolveSigner(
        address,
        screen.dataset["participantNetwork"] ?? "",
      );
      finish({
        address: signer.address,
        label:
          signer.accountContractType === "argent"
            ? t("multisig.participant.readyAccount")
            : t("multisig.participant.brambleAccount"),
        publicKeyX: signer.publicKeyX,
        source: t("multisig.participant.accountAddress"),
      });
    } catch (error) {
      result.textContent = errorLine(error, t("multisig.participant.lookupFailed"));
      showToast(errorDetails(error, t("multisig.participant.lookupFailedShort")), "error", confirm);
    } finally {
      buttonBusy(confirm, false);
    }
  };
  const submit = (): Promise<void> =>
    method === "wallet-card"
      ? submitWalletCard()
      : method === "public-key"
        ? submitPublicKey()
        : submitAddress();

  open.addEventListener("click", () => {
    origin.hidden = true;
    screen.hidden = false;
    selectMethod("address");
  });
  screen
    .querySelector<HTMLButtonElement>("[data-close-participant-picker]")
    ?.addEventListener("click", close);
  screen.querySelectorAll<HTMLButtonElement>("[data-participant-method]").forEach((control) => {
    control.addEventListener("click", () =>
      selectMethod(
        control.dataset["participantMethod"] === "public-key"
          ? "public-key"
          : control.dataset["participantMethod"] === "wallet-card"
            ? "wallet-card"
            : "address",
      ),
    );
  });
  screen.querySelectorAll<HTMLButtonElement>("[data-participant-key]").forEach((control) => {
    control.addEventListener("click", () => {
      const publicKeyX = control.dataset["participantKey"];
      if (!publicKeyX) return;
      void finish({
        ...(control.dataset["participantAddress"]
          ? { address: control.dataset["participantAddress"] }
          : {}),
        label:
          control.dataset["participantLabel"] ??
          t("multisig.participant.signerLabel", { key: accountLabel(publicKeyX) }),
        publicKeyX,
        source: control.dataset["participantSource"] ?? t("multisig.participant.known"),
      });
    });
  });
  confirm.addEventListener("click", () => void submit());
  for (const input of [addressInput, publicKeyInput, labelInput, walletCardInput]) {
    if (!input) continue;
    input.addEventListener("input", () => {
      result.textContent = "";
    });
    input.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Enter") return;
      event.preventDefault();
      void submit();
    });
  }
};
