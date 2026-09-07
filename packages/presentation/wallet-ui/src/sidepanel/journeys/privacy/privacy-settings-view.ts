/**
 * STRK20 service-routing form for the advanced network screen.
 */
import { escapeHtml } from "@bramble/core/html";
import type { Strk20NetworkConfig } from "@bramble/privacy/config";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";

/**
 * Renders complete, public per-network privacy infrastructure configuration.
 * Credentials are intentionally absent because extension bundles cannot keep
 * shared service secrets.
 */
export const strk20ServicesForm = (
  network: string,
  config: Strk20NetworkConfig | null,
): string => `<form id="strk20-services-form" class="stack">
  ${textField({
    autocomplete: "off",
    className: "mono",
    label: "Discovery service",
    name: "discoveryUrl",
    placeholder: "https://discovery.example",
    spellcheck: false,
    type: "url",
    value: config?.discoveryUrl ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    label: "Transaction prover",
    name: "proverUrl",
    placeholder: "https://prover.example",
    spellcheck: false,
    type: "url",
    value: config?.proverUrl ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    label: "Privacy pool contract",
    name: "poolAddress",
    placeholder: "0x…",
    spellcheck: false,
    value: config?.poolAddress ?? "",
  })}
  <label class="field checkbox-field">
    <input ${config?.ohttpEnabled ? "checked" : ""} name="ohttpEnabled" type="checkbox">
    <span>Encrypt discovery and proving requests with OHTTP</span>
    <small>Requires OHTTP support at both services. The gateway then sees only encrypted envelopes.</small>
  </label>
  ${textField({
    autocomplete: "off",
    className: "mono",
    hint: "Optional SDK module for subaccount_invoke. Dapp anonymizers are reviewed transaction targets, not network settings.",
    label: "SDK sub-account module",
    name: "subaccountAnonymizerAddress",
    placeholder: "0x…",
    spellcheck: false,
    value: config?.subaccountAnonymizerAddress ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    hint: "Optional relay that hides prover traffic metadata.",
    label: "OHTTP relay",
    name: "ohttpRelayUrl",
    placeholder: "https://relay.example",
    spellcheck: false,
    type: "url",
    value: config?.ohttpRelayUrl ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    hint: "Required for private transfer, withdrawal, and invoke relay. Registration and deposit-only shielding can use the selected account.",
    label: "Private paymaster",
    name: "paymasterUrl",
    placeholder: "https://paymaster.example",
    spellcheck: false,
    type: "url",
    value: config?.paymaster?.url ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    label: "Paymaster fee token",
    name: "feeToken",
    placeholder: "0x…",
    spellcheck: false,
    value: config?.paymaster?.feeToken ?? "",
  })}
  ${button({
    icon: "check",
    label: "Save privacy services",
    type: "submit",
    variant: "secondary",
  })}
  <p class="hint">Clear every field to disable STRK20 on ${escapeHtml(network)}. API credentials are intentionally unsupported in the extension.</p>
  <p id="strk20-services-result" role="status"></p>
</form>`;
