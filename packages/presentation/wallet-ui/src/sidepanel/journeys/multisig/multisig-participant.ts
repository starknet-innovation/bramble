/** Shared participant picker for multisig setup and signer management. */
import { escapeHtml } from "@mc-wallet/core/html";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { inputControl } from "@mc-wallet/ui-kit/fields";
import { icon } from "@mc-wallet/ui-kit/icons";
import { isNonZeroStarkFieldElement, normalizeFeltInput } from "@mc-wallet/wallet-model/networks";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { accountAvatar, accountLabel } from "../../shared/parts";
import type { MultisigClient } from "./multisig-runtime";

/**
 * Validated public participant metadata used only after explicit user selection.
 */
export type MultisigParticipant = {
  readonly address?: string;
  readonly label: string;
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
      <span class="option-sub">${escapeHtml(source)} · Key ${escapeHtml(accountLabel(publicKeyX))}</span>
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
      ${iconButton({ attributes: { "data-close-participant-picker": true }, icon: "chevronLeft", label: "Back to signer setup", variant: "ghost" })}
      <div><h2>Add participant</h2><p>Use an account address or shared public key.</p></div>
    </header>
    ${
      options.length > 0
        ? `<details class="disclosure multisig-participant-known">
            <summary><span class="menu-copy"><strong>Choose known participant</strong><small>${options.length} from this wallet and Address book</small></span><span class="disclosure-mark">${icon("chevronRight")}</span></summary>
            <div class="disclosure-body"><div class="option-list" role="list">${options.map(knownParticipant).join("")}</div></div>
          </details>`
        : ""
    }
    <div class="multisig-participant-external">
      <h3>${options.length > 0 ? "Add someone else" : "Participant details"}</h3>
      <div class="multisig-participant-methods" role="group" aria-label="Participant detail type">
        <button data-participant-method="address" type="button" aria-pressed="true">
          <span>${icon("wallet")}</span><strong>Account address</strong><small>Find key on-chain</small>
        </button>
        <button data-participant-method="public-key" type="button" aria-pressed="false">
          <span>${icon("link")}</span><strong>Public key</strong><small>Use a key they shared</small>
        </button>
      </div>
      <div data-participant-field="address">
        <label><span>Participant account address</span>${inputControl({ ariaLabel: "Participant account address", attributes: { "data-participant-address-input": true }, autocapitalize: "none", className: "mono", placeholder: "0x…", spellcheck: false })}</label>
        <p class="hint">For deployed OpenZeppelin or Argent accounts.</p>
      </div>
      <div data-participant-field="public-key" hidden>
        <label><span>Participant public key</span>${inputControl({ ariaLabel: "Participant public key", attributes: { "data-participant-key-input": true }, autocapitalize: "none", className: "mono", placeholder: "0x…", spellcheck: false })}</label>
        <p class="hint">Use a key shared by the participant.</p>
      </div>
      ${button({ attributes: { "data-confirm-participant": true }, label: "Find signer key" })}
      <p data-participant-result role="status" aria-live="polite"></p>
    </div>
  </section>`;

/**
 * Runtime lookup and origin-owned selection gate; either may reject the participant.
 */
export type MultisigParticipantPickerDeps = {
  readonly multisig: Pick<MultisigClient, "resolveSigner">;
  readonly onSelect: (participant: MultisigParticipant) => string | null;
};

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
  const result = screen?.querySelector<HTMLElement>("[data-participant-result]");
  if (!origin || !screen || !open || !confirm || !addressInput || !publicKeyInput || !result)
    return;
  let method: "address" | "public-key" = "address";

  const close = (): void => {
    screen.hidden = true;
    origin.hidden = false;
    open.focus({ preventScroll: true });
  };
  const finish = (participant: MultisigParticipant): void => {
    const selectionError = deps.onSelect(participant);
    if (selectionError) {
      result.textContent = selectionError;
      showToast(selectionError, "error", confirm);
      return;
    }
    addressInput.value = "";
    publicKeyInput.value = "";
    result.textContent = "";
    close();
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
    confirm.textContent = method === "address" ? "Find signer key" : "Add public key";
    result.textContent = "";
    (method === "address" ? addressInput : publicKeyInput).focus({ preventScroll: true });
  };
  const submit = async (): Promise<void> => {
    if (method === "public-key") {
      const publicKeyX = normalizeFeltInput(publicKeyInput.value);
      if (!isNonZeroStarkFieldElement(publicKeyX)) {
        result.textContent = "Enter a valid non-zero Starknet public key.";
        showToast(result.textContent, "error", publicKeyInput);
        publicKeyInput.focus();
        return;
      }
      finish({
        label: `Signer ${accountLabel(publicKeyX)}`,
        publicKeyX,
        source: "Shared public key",
      });
      return;
    }
    const address = normalizeFeltInput(addressInput.value);
    if (!isNonZeroStarkFieldElement(address)) {
      result.textContent = "Enter a valid non-zero Starknet account address.";
      showToast(result.textContent, "error", addressInput);
      addressInput.focus();
      return;
    }
    buttonBusy(confirm, true);
    result.textContent = "Checking the account contract and signer key…";
    try {
      const signer = await deps.multisig.resolveSigner(
        address,
        screen.dataset["participantNetwork"] ?? "",
      );
      finish({
        address: signer.address,
        label: signer.accountContractType === "argent" ? "Argent account" : "OpenZeppelin account",
        publicKeyX: signer.publicKeyX,
        source: "Account address",
      });
    } catch (error) {
      const message = errorMessage(error, "Signer key lookup failed");
      result.textContent = message;
      showToast(message, "error", confirm);
    } finally {
      buttonBusy(confirm, false);
    }
  };

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
        control.dataset["participantMethod"] === "public-key" ? "public-key" : "address",
      ),
    );
  });
  screen.querySelectorAll<HTMLButtonElement>("[data-participant-key]").forEach((control) => {
    control.addEventListener("click", () => {
      const publicKeyX = control.dataset["participantKey"];
      if (!publicKeyX) return;
      finish({
        ...(control.dataset["participantAddress"]
          ? { address: control.dataset["participantAddress"] }
          : {}),
        label: control.dataset["participantLabel"] ?? `Signer ${accountLabel(publicKeyX)}`,
        publicKeyX,
        source: control.dataset["participantSource"] ?? "Known participant",
      });
    });
  });
  confirm.addEventListener("click", () => void submit());
  for (const input of [addressInput, publicKeyInput]) {
    input.addEventListener("input", () => {
      result.textContent = "";
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void submit();
    });
  }
};
