/**
 * Recipient, asset-picker, and amount-composition DOM bindings for Send. This
 * module changes only extension-owned form state and delegates journey stages
 * to the parent transfer state machine.
 */
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { StarkNameResolutionResponse } from "../../../popup/responses/responses";
import { formatFiat } from "../../shared/fiat";
import { accountLabel } from "../../shared/parts";
import { bindTokenDropdown } from "../../shared/token-dropdown";
import { setAddressBookDraft } from "../../shell/address-draft";
import {
  balanceShortcut,
  fiatInputToken,
  sendBalanceLine,
  sendCurrencySymbol,
  tokenInputFiat,
} from "./send-model";
import {
  isStarkName,
  recipientFieldError,
  type TransferExitView,
  type TransferFields,
  type TransferStage,
  transferFields,
} from "./transfer-model";

type Currency = "eur" | "gbp" | "usd";

/**
 * Returns one named hidden field from the production Send form.
 */
export const sendFormInput = (form: HTMLFormElement, name: string): HTMLInputElement | null =>
  form.querySelector<HTMLInputElement>(`input[name="${name}"]`);

/**
 * Updates one named hidden field when it exists.
 */
const setSendFormValue = (form: HTMLFormElement, name: string, value: string): void => {
  const input = sendFormInput(form, name);
  if (input) input.value = value;
};

/**
 * Clears the chosen recipient when the user steps back to the recipient stage,
 * so no review can be built from a recipient the current step no longer shows
 * (audit 248). A scoped-intent recipient is cleared too: going Back is an
 * explicit request to choose again.
 */
export const clearSendRecipient = (form: HTMLFormElement): void => {
  setSendFormValue(form, "recipient", "");
  setSendFormValue(form, "recipientLabel", "");
};

const copySelectedGlyph = (form: HTMLFormElement, source: Element | null): void => {
  const target = form.querySelector<HTMLElement>("#send-selected-token-glyph");
  if (!target || !source) return;
  target.replaceChildren(...Array.from(source.childNodes, (node) => node.cloneNode(true)));
};

/**
 * Restores recipient, token, balance, and amount presentation after a shell
 * repaint without disturbing a field the user is actively editing.
 */
export const restoreTransferCompose = (form: HTMLFormElement, fields: TransferFields): void => {
  const text = (id: string, value: string): void => {
    const node = form.querySelector(`#${id}`);
    if (node) node.textContent = value;
  };
  text("send-recipient-name", fields.recipientLabel || accountLabel(fields.recipient));
  text("send-recipient-label", accountLabel(fields.recipient));
  const recipientCopy = form.querySelector<HTMLButtonElement>("#send-recipient-copy");
  if (recipientCopy) {
    recipientCopy.dataset["copy"] = fields.recipient;
    recipientCopy.hidden = fields.recipient === "";
  }
  text("send-selected-token-symbol", fields.tokenSymbol);
  // An empty formatted balance is one the bucket controls could not read.
  text(
    "send-balance-label",
    sendBalanceLine(fields.source, fields.tokenFormatted || null, fields.tokenSymbol),
  );
  const asset = Array.from(form.querySelectorAll<HTMLElement>("[data-send-asset]")).find(
    (row) => row.dataset["sendAsset"] === fields.tokenId,
  );
  copySelectedGlyph(form, asset?.querySelector(".send-asset-glyph") ?? null);
  const amount = form.querySelector<HTMLInputElement>("#send-amount-input");
  if (
    amount &&
    form.dataset["amountMode"] !== "fiat" &&
    amount !== amount.ownerDocument.activeElement
  ) {
    amount.value = fields.amount;
  }
};

const currencyFor = (form: HTMLFormElement): Currency => {
  const value = form.querySelector("#send-unit-label")?.textContent?.toLowerCase();
  return value === "eur" || value === "gbp" ? value : "usd";
};

const updateAmountPresentation = (
  form: HTMLFormElement,
  onFields: (fields: TransferFields) => void,
): void => {
  const visible = form.querySelector<HTMLInputElement>("#send-amount-input");
  if (!visible) return;
  const mode = form.dataset["amountMode"] === "fiat" ? "fiat" : "token";
  const priceText = sendFormInput(form, "tokenPrice")?.value ?? "";
  const price = priceText.length > 0 ? Number(priceText) : undefined;
  const decimals = Number(sendFormInput(form, "tokenDecimals")?.value ?? "0");
  const currency = currencyFor(form);
  if (mode === "fiat") {
    const amount = fiatInputToken(visible.value, price, decimals) ?? "";
    setSendFormValue(form, "amount", amount);
    const fiat = Number(visible.value);
    setSendFormValue(
      form,
      "fiatEstimate",
      Number.isFinite(fiat) && fiat > 0 ? formatFiat(fiat, currency) : "",
    );
    const estimate = amount
      ? `≈ ${amount} ${sendFormInput(form, "tokenSymbol")?.value ?? "token"}`
      : "Token amount —";
    const node = form.querySelector("#send-fiat-estimate");
    if (node) node.textContent = estimate;
  } else {
    setSendFormValue(form, "amount", visible.value.trim());
    const fiat = tokenInputFiat(visible.value, price);
    const formatted = fiat === null ? "" : formatFiat(fiat, currency);
    setSendFormValue(form, "fiatEstimate", formatted);
    const node = form.querySelector("#send-fiat-estimate");
    if (node) node.textContent = formatted ? `Estimated value ${formatted}` : "Estimated value —";
  }
  onFields(transferFields(form));
};

const applySelectedAsset = (form: HTMLFormElement, row: HTMLElement): void => {
  const fields: Readonly<Record<string, string>> = {
    tokenAddress: row.dataset["sendAddress"] ?? "",
    tokenBalance: row.dataset["sendBalance"] ?? "0",
    tokenDecimals: row.dataset["sendDecimals"] ?? "0",
    tokenFormatted: row.dataset["sendFormatted"] ?? "0",
    tokenId: row.dataset["sendAsset"] ?? "",
    tokenPrice: row.dataset["sendPrice"] ?? "",
    tokenSymbol: row.dataset["sendSymbol"] ?? "token",
  };
  for (const [name, value] of Object.entries(fields)) setSendFormValue(form, name, value);
  const symbol = fields["tokenSymbol"] ?? "token";
  const symbolNode = form.querySelector("#send-selected-token-symbol");
  if (symbolNode) symbolNode.textContent = symbol;
  const balanceNode = form.querySelector("#send-balance-label");
  if (balanceNode) {
    // The picker row carries the public balance, so the line names that bucket.
    balanceNode.textContent = sendBalanceLine("public", fields["tokenFormatted"] ?? "0", symbol);
  }
  copySelectedGlyph(form, row.querySelector(".send-asset-glyph"));
  const visible = form.querySelector<HTMLInputElement>("#send-amount-input");
  if (visible) visible.value = "";
  setSendFormValue(form, "amount", "");
  setSendFormValue(form, "fiatEstimate", "");
};

// The name of the row the typed address belongs to: one of the user's own
// accounts, a saved contact, or a shared account, all on this network. Compared
// as felts, so a padded or differently cased spelling of a known address is
// still known. Names only ever come from the user's own rows, never from the
// typed text, and the review keeps the real address beside them.
const knownRecipientLabel = (form: HTMLFormElement, address: string): string | undefined =>
  [...form.querySelectorAll<HTMLElement>("[data-send-recipient]")].find((row) =>
    sameFelt(row.dataset["sendRecipient"] ?? "", address),
  )?.dataset["sendRecipientLabel"];

// True when the typed address matches no row on the screen. The same lookup as
// the name, so "Save address" and the name shown can never disagree.
const isUnlistedRecipient = (form: HTMLFormElement, address: string): boolean =>
  knownRecipientLabel(form, address) === undefined;

// True when the row sits in a folder the user has minimized. The archive starts
// that way; every other folder starts open.
const inCollapsedFolder = (row: HTMLElement): boolean =>
  row.closest<HTMLElement>("[data-send-folder]")?.dataset["collapsed"] === "true";

const bindRecipientControls = (
  form: HTMLFormElement,
  goTo: (stage: TransferStage) => void,
  onFields: (fields: TransferFields) => void,
  navigate?: (view: TransferExitView) => void,
  resolveName?: (name: string) => Promise<StarkNameResolutionResponse | null>,
): void => {
  const search = form.querySelector<HTMLInputElement>("#send-recipient-search");
  const continueButton = form.querySelector<HTMLButtonElement>("#send-recipient-continue");
  const saveRow = form.querySelector<HTMLElement>("#send-recipient-save-row");
  const note = form.querySelector<HTMLElement>("#send-recipient-note");
  const setNote = (message: string): void => {
    if (!note) return;
    note.textContent = message;
    note.toggleAttribute("hidden", message.length === 0);
  };
  const updateSearch = (): void => {
    const query = search?.value.trim().toLowerCase() ?? "";
    let visible = 0;
    form.querySelectorAll<HTMLElement>("[data-send-recipient]").forEach((row) => {
      const matches = query.length === 0 || (row.dataset["sendSearch"] ?? "").includes(query);
      // A search reaches into a minimized folder: a recipient the user is
      // looking for must be findable wherever it is filed. With no query the
      // folder decides, so the archive stays out of the way.
      const folded = query.length === 0 && inCollapsedFolder(row);
      row.toggleAttribute("hidden", !matches || folded);
      if (matches) visible += 1;
    });
    // A folder with nothing to show during a search drops out rather than
    // leaving a heading over an empty space.
    form.querySelectorAll<HTMLElement>("[data-send-folder]").forEach((folder) => {
      const rows = [...folder.querySelectorAll<HTMLElement>("[data-send-recipient]")];
      const shown = rows.filter((row) => !row.hasAttribute("hidden")).length;
      folder.toggleAttribute("hidden", query.length > 0 && shown === 0);
    });
    form.querySelector("#send-recipient-empty")?.toggleAttribute("hidden", visible > 0);
    const typed = search?.value ?? "";
    // A bare address, or a Starknet name the background can resolve, is enough
    // to step forward; anything else keeps the step from advancing.
    const addressValid = recipientFieldError(typed) === null;
    const nameValid = !addressValid && isStarkName(typed);
    if (continueButton) continueButton.disabled = !(addressValid || nameValid);
    // Offered only for an address that is both usable and not already known,
    // so saving is a deliberate act on a new recipient rather than a way to
    // duplicate a contact under a second name. A name is never offered: the
    // address book holds addresses, and a name only becomes one once resolved.
    saveRow?.toggleAttribute(
      "hidden",
      !(navigate && addressValid && isUnlistedRecipient(form, typed)),
    );
  };
  search?.addEventListener("input", () => {
    // A new keystroke retires the previous name's resolving or error note.
    setNote("");
    updateSearch();
  });
  // Folder state is DOM-local: the recipient stage is toggled rather than
  // re-rendered, so a collapse survives without threading state through the
  // entrypoint the way the drawer does.
  form.querySelectorAll<HTMLButtonElement>("[data-send-folder-toggle]").forEach((head) => {
    head.addEventListener("click", () => {
      const folder = head.closest<HTMLElement>("[data-send-folder]");
      if (!folder) {
        return;
      }
      const collapsed = folder.dataset["collapsed"] !== "true";
      folder.dataset["collapsed"] = String(collapsed);
      head.setAttribute("aria-expanded", String(!collapsed));
      updateSearch();
    });
  });
  form.querySelector("#send-recipient-save")?.addEventListener("click", () => {
    const typed = search?.value.trim() ?? "";
    if (recipientFieldError(typed) === null) {
      setAddressBookDraft(typed);
      navigate?.("address-book");
    }
  });
  const choose = (address: string, label: string): void => {
    setNote("");
    setSendFormValue(form, "recipient", address);
    setSendFormValue(form, "recipientLabel", label);
    onFields(transferFields(form));
    goTo("details");
  };
  form.querySelectorAll<HTMLElement>("[data-send-recipient]").forEach((row) => {
    row.addEventListener("click", () =>
      choose(row.dataset["sendRecipient"] ?? "", row.dataset["sendRecipientLabel"] ?? ""),
    );
  });
  // Reads a name-resolution failure into the same short, literal note the
  // resolving step shows. A resolved outcome never reaches here.
  const resolutionFailure = (
    response: StarkNameResolutionResponse | null,
    name: string,
  ): string => {
    if (response === null) {
      return `Could not resolve ${name}.`;
    }
    switch (response.resolution.status) {
      case "not-found":
        return `No address found for ${name}.`;
      case "unreachable":
        return `Could not reach the network to resolve ${name}.`;
      case "unsupported-network":
        return "Starknet names are not available on this network.";
      default:
        return `Could not resolve ${name}.`;
    }
  };
  // Commits the typed value as the recipient. A bare address is taken as is; a
  // Starknet name is resolved to an address first, and only the resolved
  // address is reviewed (its label stays the typed name). Shared by "Continue
  // with address" and Enter in the search field: without the latter, Enter fell
  // through to implicit form submission and reviewed the PREVIOUSLY chosen
  // hidden recipient, not the address on screen (audit 248).
  let resolving = false;
  const commitTyped = async (): Promise<void> => {
    if (resolving) return;
    const typed = search?.value.trim() ?? "";
    if (recipientFieldError(typed) === null) {
      // A pasted address that is already on the screen reads as the row it
      // matches, the same as tapping that row would.
      choose(typed, knownRecipientLabel(form, typed) || accountLabel(typed));
      return;
    }
    if (!isStarkName(typed) || !resolveName) {
      search?.focus();
      return;
    }
    resolving = true;
    if (continueButton) continueButton.disabled = true;
    setNote(`Resolving ${typed}…`);
    let response: StarkNameResolutionResponse | null = null;
    try {
      response = await resolveName(typed);
    } catch {
      // A thrown resolver is the same failure as a malformed reply: no address
      // is committed, and the field says so rather than staying stuck on
      // "Resolving".
      response = null;
    } finally {
      resolving = false;
    }
    // A repaint or close while the read was in flight leaves this form
    // detached; a resolution that lands there must not commit a recipient.
    // The same applies when the text was edited since: the commit that lands
    // is for a name the field no longer shows.
    if (!form.isConnected || (search?.value.trim() ?? "") !== typed) return;
    if (response?.resolution.status === "resolved") {
      choose(response.resolution.address, typed);
      return;
    }
    // Re-enable the control for the current text (which is still a valid name)
    // before showing why the last attempt did not commit.
    updateSearch();
    setNote(resolutionFailure(response, typed));
    search?.focus();
  };
  continueButton?.addEventListener("click", () => {
    void commitTyped();
  });
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitTyped();
    }
  });
  updateSearch();
};

const bindAssetControls = (
  form: HTMLFormElement,
  onFields: (fields: TransferFields) => void,
  navigate?: (view: TransferExitView) => void,
): void => {
  bindTokenDropdown({
    onAction: () => navigate?.("tokens"),
    onSelect: (tokenId) => {
      // The dropdown returns an id; the token's numbers come from the hidden
      // carrier the view rendered for it, so composing reads one source.
      const facts = form.querySelector<HTMLElement>(`[data-send-asset="${CSS.escape(tokenId)}"]`);
      if (!facts) {
        return;
      }
      applySelectedAsset(form, facts);
      onFields(transferFields(form));
    },
    panelId: "send-token-options",
    root: form.querySelector("#send-token-trigger")?.closest(".token-dropdown") ?? null,
    triggerId: "send-token-trigger",
  });
  // Open on STRK rather than "Select": it pays every fee on Starknet, so it is
  // the asset a send most often means. Only applied when nothing is chosen yet,
  // so a repaint never overwrites the user's own pick.
  if (!sendFormInput(form, "tokenId")?.value && form.dataset["sendIntent"] !== "true") {
    const strk = Array.from(form.querySelectorAll<HTMLElement>("[data-send-asset]")).find((row) =>
      sameFelt(row.dataset["sendAddress"] ?? "0x0", STRK_TOKEN_ADDRESS),
    );
    if (strk) {
      applySelectedAsset(form, strk);
      onFields(transferFields(form));
    }
  }
};

const bindAmountControls = (
  form: HTMLFormElement,
  onFields: (fields: TransferFields) => void,
  spendable?: () => bigint | null,
): void => {
  const currentForm = form;
  const visible = form.querySelector<HTMLInputElement>("#send-amount-input");
  visible?.addEventListener("input", () => {
    visible.setCustomValidity("");
    updateAmountPresentation(form, onFields);
  });
  const useBalance = (fraction: "half" | "max"): void => {
    if (!visible) return;
    // The route decides what is actually spendable: a pool fee charged in the
    // token being sent is reserved, and an unread fee withholds a maximum
    // entirely rather than offering an amount the pool would reject.
    const routeSpendable = spendable?.();
    if (routeSpendable === null) return;
    currentForm.dataset["amountMode"] = "token";
    visible.value = balanceShortcut(
      (routeSpendable ?? sendFormInput(form, "tokenBalance")?.value ?? "0").toString(),
      Number(sendFormInput(form, "tokenDecimals")?.value ?? "0"),
      fraction,
    );
    form.querySelector("#send-amount-prefix")?.toggleAttribute("hidden", true);
    updateAmountPresentation(form, onFields);
  };
  form.querySelector("#send-half")?.addEventListener("click", () => useBalance("half"));
  form.querySelector("#send-max")?.addEventListener("click", () => useBalance("max"));
  form.querySelector("#send-unit-toggle")?.addEventListener("click", () => {
    if (!visible) return;
    const currency = currencyFor(form);
    const next = form.dataset["amountMode"] === "fiat" ? "token" : "fiat";
    const tokenAmount = sendFormInput(form, "amount")?.value ?? "";
    const priceText = sendFormInput(form, "tokenPrice")?.value ?? "";
    const fiat = tokenInputFiat(tokenAmount, priceText ? Number(priceText) : undefined);
    currentForm.dataset["amountMode"] = next;
    visible.value = next === "fiat" ? (fiat?.toFixed(2).replace(/\.00$/, "") ?? "") : tokenAmount;
    const prefix = form.querySelector<HTMLElement>("#send-amount-prefix");
    prefix?.toggleAttribute("hidden", next !== "fiat");
    if (prefix) prefix.textContent = sendCurrencySymbol(currency);
    const unit = form.querySelector("#send-unit-label");
    if (unit) {
      unit.textContent =
        next === "fiat"
          ? (sendFormInput(form, "tokenSymbol")?.value ?? "Token")
          : currency.toUpperCase();
    }
    updateAmountPresentation(form, onFields);
    visible.focus();
  });
};

/**
 * Binds all pre-review Send composition controls.
 */
export const bindTransferCompose = ({
  form,
  goTo,
  navigate,
  onFields,
  resolveName,
  spendable,
}: {
  readonly form: HTMLFormElement;
  readonly goTo: (stage: TransferStage) => void;
  readonly onFields: (fields: TransferFields) => void;
  /** Leaves Send for another screen: the address book, or token management. */
  readonly navigate?: (view: TransferExitView) => void;
  /** Resolves a typed Starknet name to an address; absent disables name entry. */
  readonly resolveName?: (name: string) => Promise<StarkNameResolutionResponse | null>;
  /** Raw spendable units for the composed route; `null` withholds Max/Half. */
  readonly spendable?: () => bigint | null;
}): void => {
  bindRecipientControls(form, goTo, onFields, navigate, resolveName);
  bindAssetControls(form, onFields, navigate);
  bindAmountControls(form, onFields, spendable);
};
