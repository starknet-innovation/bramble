/**
 * Recipient, asset-picker, and amount-composition DOM bindings for Send. This
 * module changes only extension-owned form state and delegates journey stages
 * to the parent transfer state machine.
 */
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
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

// True when the typed address matches no row on the screen: not one of the
// user's own accounts, and not a saved contact. Compared as felts, so a padded
// or differently cased spelling of a known address is still known.
const isUnlistedRecipient = (form: HTMLFormElement, address: string): boolean =>
  ![...form.querySelectorAll<HTMLElement>("[data-send-recipient]")].some((row) =>
    sameFelt(row.dataset["sendRecipient"] ?? "", address),
  );

// True when the row sits in a folder the user has minimized. The archive starts
// that way; every other folder starts open.
const inCollapsedFolder = (row: HTMLElement): boolean =>
  row.closest<HTMLElement>("[data-send-folder]")?.dataset["collapsed"] === "true";

const bindRecipientControls = (
  form: HTMLFormElement,
  goTo: (stage: TransferStage) => void,
  onFields: (fields: TransferFields) => void,
  navigate?: (view: TransferExitView) => void,
): void => {
  const search = form.querySelector<HTMLInputElement>("#send-recipient-search");
  const continueButton = form.querySelector<HTMLButtonElement>("#send-recipient-continue");
  const saveRow = form.querySelector<HTMLElement>("#send-recipient-save-row");
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
    const valid = recipientFieldError(typed) === null;
    if (continueButton) continueButton.disabled = !valid;
    // Offered only for an address that is both usable and not already known,
    // so saving is a deliberate act on a new recipient rather than a way to
    // duplicate a contact under a second name.
    saveRow?.toggleAttribute("hidden", !(navigate && valid && isUnlistedRecipient(form, typed)));
  };
  search?.addEventListener("input", updateSearch);
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
  continueButton?.addEventListener("click", () => {
    const address = search?.value.trim() ?? "";
    if (recipientFieldError(address)) {
      search?.focus();
      return;
    }
    choose(address, accountLabel(address));
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
  spendable,
}: {
  readonly form: HTMLFormElement;
  readonly goTo: (stage: TransferStage) => void;
  readonly onFields: (fields: TransferFields) => void;
  /** Leaves Send for another screen: the address book, or token management. */
  readonly navigate?: (view: TransferExitView) => void;
  /** Raw spendable units for the composed route; `null` withholds Max/Half. */
  readonly spendable?: () => bigint | null;
}): void => {
  bindRecipientControls(form, goTo, onFields, navigate);
  bindAssetControls(form, onFields, navigate);
  bindAmountControls(form, onFields, spendable);
};
