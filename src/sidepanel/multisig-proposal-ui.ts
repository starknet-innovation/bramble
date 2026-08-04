/**
 * State and bindings for the recipient-first Multisig proposal journey.
 * User-friendly transfer fields are converted into the same exact call shape
 * the advanced path reviews; only the reviewed shape can be submitted.
 */
import { escapeHtml } from "../shared/html";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  normalizeFeltInput,
} from "../starknet/networks";
import { buildErc20TransferCall, parseTokenAmount } from "../starknet/rpc";
import { buttonBusy, errorMessage, renderFragment, showToast } from "./dom";
import { formatFiat } from "./fiat";
import { icon } from "./icons";
import type { MultisigClient } from "./multisig-runtime";
import { accountLabel } from "./parts";
import { balanceShortcut, fiatInputToken, sendCurrencySymbol, tokenInputFiat } from "./send-model";
import { transitionProposalStage } from "./send-transition";
import { tokenGlyph } from "./token-row";

type ProposalStage = "advanced" | "amount" | "asset" | "recipient" | "review";

type ProposalFields = {
  readonly amount?: string;
  readonly calldata: readonly string[];
  readonly entrypoint: string;
  readonly mode: "advanced" | "send";
  readonly recipientLabel?: string;
  readonly salt: string;
  readonly summary: string;
  readonly symbol?: string;
  readonly to: string;
};

/**
 * Minimal dependencies needed by the proposal journey.
 */
export type MultisigProposalUiDeps = {
  readonly app: Element | null;
  readonly multisig: MultisigClient;
  readonly openDetail: (id: string) => void;
  readonly runAction: (
    button: HTMLButtonElement | null | undefined,
    resultId: string,
    pendingMessage: string,
    action: () => Promise<string>,
  ) => void;
  readonly selectedMultisigId: () => string | null;
  readonly setResult: (id: string, message: string) => void;
};

const field = (form: HTMLFormElement, name: string): HTMLInputElement | null =>
  form.querySelector<HTMLInputElement>(`input[name="${name}"]`);

const setField = (form: HTMLFormElement, name: string, value: string): void => {
  const target = field(form, name);
  if (target) target.value = value;
};

const setText = (form: HTMLFormElement, id: string, value: string): void => {
  const target = form.querySelector(`#${id}`);
  if (target) target.textContent = value;
};

const showStage = (form: HTMLFormElement, stage: ProposalStage): void => {
  transitionProposalStage(form.ownerDocument, form.dataset["proposalStage"], stage, () => {
    const targetForm = form;
    targetForm.dataset["proposalStage"] = stage;
    form.querySelectorAll<HTMLElement>("[data-proposal-stage-panel]").forEach((panel) => {
      const target = panel;
      target.hidden = target.dataset["proposalStagePanel"] !== stage;
    });
    const options = form.querySelector<HTMLElement>("[data-proposal-options]");
    if (options) options.hidden = stage !== "amount" && stage !== "advanced";
    form.querySelector<HTMLElement>(`[data-proposal-stage-panel="${stage}"] input`)?.focus();
  });
};

const normalizedAddress = (value: string): string | null => {
  const normalized = normalizeFeltInput(value.trim());
  return isNonZeroStarkFieldElement(normalized) ? normalized : null;
};

const bindRecipient = (form: HTMLFormElement, invalidate: () => void): void => {
  const targetForm = form;
  const search = form.querySelector<HTMLInputElement>("#proposal-recipient-search");
  const continueButton = form.querySelector<HTMLButtonElement>("#proposal-recipient-continue");
  const empty = form.querySelector<HTMLElement>("#proposal-recipient-empty");
  const applyRecipient = (address: string, label: string): void => {
    setField(form, "guidedRecipient", address);
    targetForm.dataset["recipientLabel"] = label;
    setText(form, "proposal-recipient-name", label);
    setText(form, "proposal-recipient-label", accountLabel(address));
    invalidate();
    showStage(form, "amount");
  };
  const filterRows = (): void => {
    const query = search?.value.trim().toLowerCase() ?? "";
    let visible = 0;
    form.querySelectorAll<HTMLButtonElement>("[data-proposal-search]").forEach((row) => {
      const target = row;
      target.hidden = query.length > 0 && !(target.dataset["proposalSearch"] ?? "").includes(query);
      if (!target.hidden && !target.closest<HTMLElement>("[hidden]")) visible += 1;
    });
    if (empty) empty.hidden = query.length === 0 || visible > 0;
    if (continueButton) continueButton.disabled = normalizedAddress(search?.value ?? "") === null;
  };
  search?.addEventListener("input", filterRows);
  continueButton?.addEventListener("click", () => {
    const address = normalizedAddress(search?.value ?? "");
    if (address) applyRecipient(address, "Entered address");
  });
  form.querySelectorAll<HTMLButtonElement>("[data-proposal-recipient]").forEach((row) => {
    row.addEventListener("click", () => {
      const address = normalizedAddress(row.dataset["proposalRecipient"] ?? "");
      if (address) applyRecipient(address, row.dataset["proposalRecipientLabel"] ?? "Recipient");
    });
  });
  form.querySelectorAll<HTMLButtonElement>("[data-proposal-recipient-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const selected = tab.dataset["proposalRecipientTab"];
      form
        .querySelectorAll<HTMLButtonElement>("[data-proposal-recipient-tab]")
        .forEach((button) => {
          button.setAttribute(
            "aria-selected",
            String(button.dataset["proposalRecipientTab"] === selected),
          );
        });
      form.querySelectorAll<HTMLElement>("[data-proposal-recipient-panel]").forEach((panel) => {
        const target = panel;
        target.hidden = target.dataset["proposalRecipientPanel"] !== selected;
      });
      filterRows();
    });
  });
};

const updateAmountPresentation = (form: HTMLFormElement): void => {
  const visible = form.querySelector<HTMLInputElement>("#proposal-amount-input");
  if (!visible) return;
  const price = Number(field(form, "guidedPrice")?.value ?? "");
  const decimals = Number(field(form, "guidedDecimals")?.value ?? "");
  const symbol = field(form, "guidedSymbol")?.value || "token";
  const currency = form.dataset["currency"] === "eur" ? "eur" : "usd";
  if (form.dataset["amountMode"] === "fiat") {
    const tokenAmount = fiatInputToken(visible.value, price, decimals);
    setField(form, "guidedAmount", tokenAmount ?? "");
    setText(
      form,
      "proposal-fiat-estimate",
      tokenAmount ? `≈ ${tokenAmount} ${symbol}` : "Token amount —",
    );
    return;
  }
  setField(form, "guidedAmount", visible.value.trim());
  const fiat = tokenInputFiat(visible.value, price);
  setText(
    form,
    "proposal-fiat-estimate",
    fiat === null ? "Estimated value —" : `Estimated value ${formatFiat(fiat, currency)}`,
  );
};

const applyToken = (form: HTMLFormElement, row: HTMLButtonElement): void => {
  const targetForm = form;
  const values: Readonly<Record<string, string>> = {
    guidedBalance: row.dataset["proposalTokenBalance"] ?? "0",
    guidedDecimals: row.dataset["proposalTokenDecimals"] ?? "",
    guidedFormatted: row.dataset["proposalTokenFormatted"] ?? "0",
    guidedPrice: row.dataset["proposalTokenPrice"] ?? "",
    guidedSymbol: row.dataset["proposalTokenSymbol"] ?? "",
    guidedToken: row.dataset["proposalToken"] ?? "",
  };
  for (const [name, value] of Object.entries(values)) setField(form, name, value);
  setText(form, "proposal-selected-token-symbol", values["guidedSymbol"] ?? "Token");
  setText(
    form,
    "proposal-balance-label",
    `Balance ${values["guidedFormatted"] ?? "0"} ${values["guidedSymbol"] ?? ""}`,
  );
  const glyph = form.querySelector("#proposal-selected-token-glyph");
  const source = row.querySelector(".token-mark, svg");
  if (glyph && source) glyph.replaceChildren(source.cloneNode(true));
  targetForm.dataset["amountMode"] = "token";
  const visible = form.querySelector<HTMLInputElement>("#proposal-amount-input");
  if (visible) visible.value = "";
  setField(form, "guidedAmount", "");
  const prefix = form.querySelector<HTMLElement>("#proposal-amount-prefix");
  if (prefix) prefix.hidden = true;
  setText(form, "proposal-unit-label", (form.dataset["currency"] ?? "usd").toUpperCase());
  updateAmountPresentation(form);
};

const bindAmountAndAssets = (form: HTMLFormElement, invalidate: () => void): void => {
  const targetForm = form;
  const visible = form.querySelector<HTMLInputElement>("#proposal-amount-input");
  visible?.addEventListener("input", () => {
    updateAmountPresentation(form);
    invalidate();
  });
  form.querySelector("#proposal-token-trigger")?.addEventListener("click", () => {
    showStage(form, "asset");
  });
  const assetSearch = form.querySelector<HTMLInputElement>("#proposal-asset-search");
  assetSearch?.addEventListener("input", () => {
    const query = assetSearch.value.trim().toLowerCase();
    let visibleCount = 0;
    form.querySelectorAll<HTMLButtonElement>("[data-proposal-token-search]").forEach((row) => {
      const target = row;
      target.hidden =
        query.length > 0 && !(target.dataset["proposalTokenSearch"] ?? "").includes(query);
      if (!target.hidden) visibleCount += 1;
    });
    const empty = form.querySelector<HTMLElement>("#proposal-asset-empty");
    if (empty) empty.hidden = query.length === 0 || visibleCount > 0;
  });
  form.querySelectorAll<HTMLButtonElement>("[data-proposal-token]").forEach((row) => {
    row.addEventListener("click", () => {
      applyToken(form, row);
      invalidate();
      showStage(form, "amount");
    });
  });
  const useBalance = (fraction: "half" | "max"): void => {
    const amount = balanceShortcut(
      field(form, "guidedBalance")?.value ?? "0",
      Number(field(form, "guidedDecimals")?.value ?? ""),
      fraction,
    );
    targetForm.dataset["amountMode"] = "token";
    if (visible) visible.value = amount;
    const prefix = form.querySelector<HTMLElement>("#proposal-amount-prefix");
    if (prefix) prefix.hidden = true;
    setText(form, "proposal-unit-label", (form.dataset["currency"] ?? "usd").toUpperCase());
    updateAmountPresentation(form);
    invalidate();
  };
  form.querySelector("#proposal-half")?.addEventListener("click", () => useBalance("half"));
  form.querySelector("#proposal-max")?.addEventListener("click", () => useBalance("max"));
  form.querySelector("#proposal-unit-toggle")?.addEventListener("click", () => {
    if (!visible) return;
    const price = Number(field(form, "guidedPrice")?.value ?? "");
    if (!Number.isFinite(price) || price <= 0) {
      showToast("A trusted display price is not available for this token", "error");
      return;
    }
    const currency = form.dataset["currency"] === "eur" ? "eur" : "usd";
    if (form.dataset["amountMode"] === "fiat") {
      visible.value = field(form, "guidedAmount")?.value ?? "";
      targetForm.dataset["amountMode"] = "token";
      const prefix = form.querySelector<HTMLElement>("#proposal-amount-prefix");
      if (prefix) prefix.hidden = true;
      setText(form, "proposal-unit-label", currency.toUpperCase());
    } else {
      const fiat = tokenInputFiat(visible.value, price);
      visible.value = fiat === null ? "" : fiat.toFixed(2);
      targetForm.dataset["amountMode"] = "fiat";
      const prefix = form.querySelector<HTMLElement>("#proposal-amount-prefix");
      if (prefix) {
        prefix.hidden = false;
        prefix.textContent = sendCurrencySymbol(currency);
      }
      setText(form, "proposal-unit-label", field(form, "guidedSymbol")?.value ?? "Token");
    }
    updateAmountPresentation(form);
    invalidate();
  });
};

const parseFelts = (raw: string): readonly string[] =>
  raw
    .split(/[\s,]+/)
    .map((felt) => normalizeFeltInput(felt))
    .filter((felt) => felt.length > 0);

const canonicalCallCalldata = (calldata: unknown): readonly string[] => {
  if (!Array.isArray(calldata)) return [];
  const felts = calldata.map((felt) => canonicalFelt(String(felt)));
  if (felts.some((felt) => felt === null)) {
    throw new Error("Could not build token transfer calldata");
  }
  return felts.filter((felt): felt is string => felt !== null);
};

const proposalFields = (form: HTMLFormElement): ProposalFields => {
  const data = new FormData(form);
  const salt = normalizeFeltInput(String(data.get("salt") ?? ""));
  if (form.dataset["proposalMode"] === "advanced") {
    return {
      calldata: parseFelts(String(data.get("calldata") ?? "")),
      entrypoint: String(data.get("entrypoint") ?? "").trim(),
      mode: "advanced",
      salt,
      summary: String(data.get("summary") ?? "").trim(),
      to: normalizeFeltInput(String(data.get("to") ?? "")),
    };
  }
  const recipient = normalizeFeltInput(field(form, "guidedRecipient")?.value ?? "");
  const token = normalizeFeltInput(field(form, "guidedToken")?.value ?? "");
  const amount = field(form, "guidedAmount")?.value.trim() ?? "";
  const decimals = Number(field(form, "guidedDecimals")?.value ?? "");
  const symbol = field(form, "guidedSymbol")?.value || "token";
  const rawAmount = parseTokenAmount(amount, decimals);
  const available = BigInt(field(form, "guidedBalance")?.value ?? "0");
  if (rawAmount > available) throw new Error(`Amount exceeds the shared ${symbol} balance`);
  const call = buildErc20TransferCall(token, recipient, rawAmount);
  const recipientLabel = form.dataset["recipientLabel"] || accountLabel(recipient);
  return {
    amount,
    // starknet.js compiles uint256 calldata as decimal strings, while the
    // extension message boundary accepts only canonical Starknet felts. Keep
    // the guided path aligned with the advanced path before review and submit.
    calldata: canonicalCallCalldata(call.calldata),
    entrypoint: call.entrypoint,
    mode: "send",
    recipientLabel,
    salt,
    summary:
      String(data.get("summary") ?? "").trim() || `Send ${amount} ${symbol} to ${recipientLabel}`,
    symbol,
    to: call.contractAddress,
  };
};

const reviewMarkup = (form: HTMLFormElement, fields: ProposalFields): string => {
  const targetLabel =
    fields.mode === "send"
      ? `${fields.symbol ?? "Token"} · Tracked ERC-20`
      : "Unclassified contract";
  const currency = form.dataset["currency"] === "eur" ? "eur" : "usd";
  const fiat =
    fields.mode === "send"
      ? tokenInputFiat(fields.amount ?? "", Number(field(form, "guidedPrice")?.value ?? ""))
      : null;
  const hero =
    fields.mode === "send"
      ? `<span class="send-review-token">${tokenGlyph(fields.to, fields.symbol ?? "Token")}</span>
         <span><strong>${escapeHtml(`${fields.amount ?? "—"} ${fields.symbol ?? "token"}`)}</strong><small>${fiat === null ? "Transfer proposed" : `${escapeHtml(formatFiat(fiat, currency))} estimated value`}</small></span>`
      : `<span class="send-review-token">${tokenGlyph(fields.to, "CALL")}</span>
         <span><strong>Advanced call</strong><small>${escapeHtml(fields.entrypoint)}</small></span>`;
  return `<div class="proposal-review-stack">
  <div class="send-review-summary">
    <div class="send-review-hero">${hero}</div>
    <dl class="send-review-facts">
      ${
        fields.mode === "send"
          ? `<div><dt>Recipient</dt><dd><strong>${escapeHtml(fields.recipientLabel ?? "Recipient")}</strong><code>${escapeHtml(accountLabel(normalizeFeltInput(field(form, "guidedRecipient")?.value ?? "")))}</code></dd></div>`
          : ""
      }
      <div><dt>From</dt><dd><strong>${escapeHtml(form.dataset["multisigName"] ?? "Shared account")}</strong><code>${escapeHtml(accountLabel(form.dataset["multisigAddress"] ?? ""))}</code></dd></div>
      <div><dt>Signer</dt><dd><strong>${escapeHtml(form.dataset["signerAccountName"] ?? "Wallet account")}</strong><code>${escapeHtml(accountLabel(form.dataset["signerAccountAddress"] ?? ""))}</code></dd></div>
      <div><dt>Network</dt><dd><strong>${escapeHtml(form.dataset["network"] ?? "Starknet")}</strong></dd></div>
    </dl>
  </div>
  <details class="send-review-disclosure">
    <summary><span>Transaction details</span><span>${icon("chevronDown")}</span></summary>
    <div class="send-review-disclosure-body">
      <dl class="request-detail">
        <div><dt>Target</dt><dd><strong>${escapeHtml(targetLabel)}</strong><code>${escapeHtml(accountLabel(fields.to))}</code></dd></div>
        <div><dt>Method</dt><dd><code>${escapeHtml(fields.entrypoint)}</code></dd></div>
        <div><dt>Parameters</dt><dd>${fields.calldata.length} felt${fields.calldata.length === 1 ? "" : "s"}</dd></div>
        <div><dt>Proposal salt</dt><dd><code>${escapeHtml(fields.salt)}</code></dd></div>
      </dl>
    </div>
  </details>
  </div>`;
};

/**
 * Binds one proposal form. Safe to call on every repaint because each form
 * instance is new and owns its own reviewed-call key.
 */
export const bindMultisigProposalForm = (deps: MultisigProposalUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-propose-form");
  if (!form) return;
  const submit = form.querySelector<HTMLButtonElement>("#proposal-submit");
  const review = form.querySelector<HTMLElement>("#multisig-propose-review");
  let reviewedKey: string | null = null;
  let editStage: "advanced" | "amount" = "amount";
  const invalidate = (): void => {
    reviewedKey = null;
    if (review) renderFragment(review, "");
  };
  bindRecipient(form, invalidate);
  bindAmountAndAssets(form, invalidate);
  form.querySelectorAll<HTMLButtonElement>("[data-proposal-stage-back]").forEach((button) => {
    button.addEventListener("click", () => {
      const stage = button.dataset["proposalStageBack"];
      if (stage === "recipient" || stage === "amount") showStage(form, stage);
    });
  });
  form.querySelector("#proposal-advanced-entry")?.addEventListener("click", () => {
    form.dataset["proposalMode"] = "advanced";
    editStage = "advanced";
    invalidate();
    showStage(form, "advanced");
  });
  const prepareReview = (): void => {
    try {
      const fields = proposalFields(form);
      reviewedKey = JSON.stringify(fields);
      editStage = fields.mode === "advanced" ? "advanced" : "amount";
      if (review) renderFragment(review, reviewMarkup(form, fields));
      deps.setResult("multisig-propose-result", "");
      showStage(form, "review");
    } catch (error: unknown) {
      const message = errorMessage(error, "Complete the proposal details");
      deps.setResult("multisig-propose-result", message);
      showToast(message, "error");
    }
  };
  form.querySelector("#proposal-review-button")?.addEventListener("click", () => {
    form.dataset["proposalMode"] = "send";
    prepareReview();
  });
  form.querySelector("#proposal-advanced-review")?.addEventListener("click", prepareReview);
  form.querySelector("#proposal-edit")?.addEventListener("click", () => {
    invalidate();
    showStage(form, editStage);
  });
  form.addEventListener("input", () => {
    if (form.dataset["proposalStage"] !== "review") invalidate();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const multisigId = deps.selectedMultisigId();
    const signerAccountId = form.dataset["signerAccountId"];
    if (!multisigId || !signerAccountId) return;
    let fields: ProposalFields;
    try {
      fields = proposalFields(form);
    } catch (error: unknown) {
      const message = errorMessage(error, "Complete the proposal details");
      deps.setResult("multisig-propose-result", message);
      showToast(message, "error");
      return;
    }
    if (reviewedKey !== JSON.stringify(fields)) {
      prepareReview();
      showToast("Review the updated proposal before submitting", "error");
      return;
    }
    buttonBusy(submit, true);
    deps.runAction(submit, "multisig-propose-result", "Submitting proposal…", async () => {
      const transactionHash = await deps.multisig.proposeTransaction({
        calldata: fields.calldata,
        entrypoint: fields.entrypoint,
        multisigId,
        salt: fields.salt,
        signerAccountId,
        summary: fields.summary,
        to: fields.to,
      });
      deps.openDetail(multisigId);
      return `Proposal submitted: ${transactionHash}`;
    });
  });
};
