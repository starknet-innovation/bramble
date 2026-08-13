/**
 * Recipient, asset-picker, and amount-composition DOM bindings for Send. This
 * module changes only extension-owned form state and delegates journey stages
 * to the parent transfer state machine.
 */
import { STRK_TOKEN_ADDRESS, sameFelt } from "@mc-wallet/wallet-model/networks";
import { formatFiat } from "../../shared/fiat";
import { accountLabel } from "../../shared/parts";
import { balanceShortcut, fiatInputToken, sendCurrencySymbol, tokenInputFiat } from "./send-model";
import {
  recipientFieldError,
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
  text("send-selected-token-symbol", fields.tokenSymbol);
  text("send-balance-label", `Balance ${fields.tokenFormatted} ${fields.tokenSymbol}`);
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
    balanceNode.textContent = `Balance ${fields["tokenFormatted"] ?? "0"} ${symbol}`;
  }
  copySelectedGlyph(form, row.querySelector(".send-asset-glyph"));
  const visible = form.querySelector<HTMLInputElement>("#send-amount-input");
  if (visible) visible.value = "";
  setSendFormValue(form, "amount", "");
  setSendFormValue(form, "fiatEstimate", "");
};

const bindRecipientControls = (
  form: HTMLFormElement,
  goTo: (stage: TransferStage) => void,
  onFields: (fields: TransferFields) => void,
): void => {
  const search = form.querySelector<HTMLInputElement>("#send-recipient-search");
  const continueButton = form.querySelector<HTMLButtonElement>("#send-recipient-continue");
  const updateSearch = (): void => {
    const query = search?.value.trim().toLowerCase() ?? "";
    let visible = 0;
    const panel = form.querySelector<HTMLElement>("[data-send-recipient-panel]:not([hidden])");
    panel?.querySelectorAll<HTMLElement>("[data-send-recipient]").forEach((row) => {
      const matches = query.length === 0 || (row.dataset["sendSearch"] ?? "").includes(query);
      row.toggleAttribute("hidden", !matches);
      if (matches) visible += 1;
    });
    form.querySelector("#send-recipient-empty")?.toggleAttribute("hidden", visible > 0);
    if (continueButton) continueButton.disabled = recipientFieldError(search?.value ?? "") !== null;
  };
  search?.addEventListener("input", updateSearch);
  form.querySelectorAll<HTMLElement>("[data-send-recipient-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset["sendRecipientTab"];
      form.querySelectorAll<HTMLElement>("[data-send-recipient-tab]").forEach((candidate) => {
        candidate.setAttribute("aria-selected", String(candidate === tab));
      });
      form.querySelectorAll<HTMLElement>("[data-send-recipient-panel]").forEach((panel) => {
        panel.toggleAttribute("hidden", panel.dataset["sendRecipientPanel"] !== id);
      });
      updateSearch();
    });
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
  goTo: (stage: TransferStage) => void,
  onFields: (fields: TransferFields) => void,
): void => {
  form.querySelector("#send-token-trigger")?.addEventListener("click", () => goTo("asset"));
  const search = form.querySelector<HTMLInputElement>("#send-asset-search");
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    form.querySelectorAll<HTMLElement>("[data-send-asset]").forEach((row) => {
      const matches = query.length === 0 || (row.dataset["sendSearch"] ?? "").includes(query);
      row.toggleAttribute("hidden", !matches);
      if (matches) visible += 1;
    });
    form.querySelector("#send-asset-empty")?.toggleAttribute("hidden", visible > 0);
  });
  form.querySelectorAll<HTMLElement>("[data-send-asset]").forEach((row) => {
    row.addEventListener("click", () => {
      applySelectedAsset(form, row);
      onFields(transferFields(form));
      goTo("details");
    });
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
  onFields,
  spendable,
}: {
  readonly form: HTMLFormElement;
  readonly goTo: (stage: TransferStage) => void;
  readonly onFields: (fields: TransferFields) => void;
  /** Raw spendable units for the composed route; `null` withholds Max/Half. */
  readonly spendable?: () => bigint | null;
}): void => {
  bindRecipientControls(form, goTo, onFields);
  bindAssetControls(form, goTo, onFields);
  bindAmountControls(form, onFields, spendable);
};
