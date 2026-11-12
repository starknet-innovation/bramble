/**
 * STRK20 service-routing form for the advanced network screen.
 */
import type { Strk20NetworkConfig } from "@bramble/privacy/config";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { t, th } from "../../../i18n/messages";

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
    label: t("privacy.settings.discovery"),
    name: "discoveryUrl",
    placeholder: "https://discovery.example",
    spellcheck: false,
    type: "url",
    value: config?.discoveryUrl ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    label: t("privacy.settings.prover"),
    name: "proverUrl",
    placeholder: "https://prover.example",
    spellcheck: false,
    type: "url",
    value: config?.proverUrl ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    label: t("privacy.settings.pool"),
    name: "poolAddress",
    placeholder: "0x…",
    spellcheck: false,
    value: config?.poolAddress ?? "",
  })}
  <label class="field checkbox-field">
    <input ${config?.ohttpEnabled ? "checked" : ""} name="ohttpEnabled" type="checkbox">
    <span>${th("privacy.settings.ohttp")}</span>
    <small>${th("privacy.settings.ohttpHint")}</small>
  </label>
  ${textField({
    autocomplete: "off",
    className: "mono",
    hint: t("privacy.settings.shadowModuleHint"),
    label: t("privacy.settings.shadowModule"),
    name: "shadowAccountAnonymizerAddress",
    placeholder: "0x…",
    spellcheck: false,
    value: config?.shadowAccountAnonymizerAddress ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    hint: t("privacy.settings.relayHint"),
    label: t("privacy.settings.relay"),
    name: "ohttpRelayUrl",
    placeholder: "https://relay.example",
    spellcheck: false,
    type: "url",
    value: config?.ohttpRelayUrl ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    hint: t("privacy.settings.paymasterHint"),
    label: t("privacy.settings.paymaster"),
    name: "paymasterUrl",
    placeholder: "https://paymaster.example",
    spellcheck: false,
    type: "url",
    value: config?.paymaster?.url ?? "",
  })}
  ${textField({
    autocomplete: "off",
    className: "mono",
    label: t("privacy.settings.feeToken"),
    name: "feeToken",
    placeholder: "0x…",
    spellcheck: false,
    value: config?.paymaster?.feeToken ?? "",
  })}
  ${button({
    icon: "check",
    label: t("privacy.settings.save"),
    type: "submit",
    variant: "secondary",
  })}
  <p class="hint">${th("privacy.settings.disableHint", { network })}</p>
  <p id="strk20-services-result" role="status"></p>
</form>`;
