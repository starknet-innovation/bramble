/**
 * Settings > Experimental features: an advanced user's local override for
 * each feature flag this build marks overridable (Default / On / Off).
 *
 * The screen only renders what the background answered and sends the user's
 * choice back; the background decides which flags may change, refuses while
 * locked, and keeps a feature Bramble turned off remotely off regardless.
 * Flag keys are escaped like any other dynamic text.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import { button, segmentedControl } from "@bramble/ui-kit/controls";
import { t, th, type UiMessageKey } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { failureTone } from "../../runtime/runtime-errors";
import { buttonBusy, errorDetails, showToast } from "../../shared/dom";
import { flowHeader, flowScreen } from "../../shared/parts";
import type {
  ExperimentalFeatures,
  ExperimentalFeaturesState,
} from "./experimental-features-runtime";

type Choice = "default" | "off" | "on";

type ChoiceLabel = Extract<
  UiMessageKey,
  "settings.experimental.default" | "settings.experimental.off" | "settings.experimental.on"
>;

const CHOICES: readonly { readonly choice: Choice; readonly label: ChoiceLabel }[] = [
  { choice: "default", label: "settings.experimental.default" },
  { choice: "on", label: "settings.experimental.on" },
  { choice: "off", label: "settings.experimental.off" },
];

const choiceOf = (features: ExperimentalFeatures, key: string): Choice => {
  if (!features.overridden.includes(key)) return "default";
  return features.flags[key] ? "on" : "off";
};

const stateLine = (features: ExperimentalFeatures, key: string): string => {
  if (features.killed.includes(key)) return t("settings.experimental.killed");
  const value = t(features.flags[key] ? "settings.experimental.on" : "settings.experimental.off");
  return t(
    features.overridden.includes(key)
      ? "settings.experimental.stateChosen"
      : "settings.experimental.stateDefault",
    { value },
  );
};

const featureRows = (features: ExperimentalFeatures): string =>
  features.overridable.length === 0
    ? emptyState(t("settings.experimental.none"))
    : `<ul class="address-book">${features.overridable
        .map((key) => {
          const killed = features.killed.includes(key);
          const current = choiceOf(features, key);
          return `<li>
              <div class="stack-tight">
                <strong class="mono">${escapeHtml(key)}</strong>
                <span class="hint">${escapeHtml(stateLine(features, key))}</span>
              </div>
              ${segmentedControl(
                key,
                CHOICES.map(({ choice, label }) => ({
                  attributes: { "data-flag-choice": choice, "data-flag-key": key },
                  disabled: killed,
                  label: t(label),
                  pressed: !killed && current === choice,
                })),
              )}
            </li>`;
        })
        .join("")}</ul>`;

const body = (state: ExperimentalFeaturesState): string => {
  if (state === "loading") return emptyState(t("settings.experimental.loading"));
  if (state === "error") {
    return `<div class="panel-error">
      ${emptyState(t("settings.experimental.loadFailed"))}
      ${button({
        attributes: {
          "aria-label": t("settings.experimental.retryLabel"),
          "data-reload-balances": true,
        },
        icon: "refresh",
        label: t("shell.tryAgain"),
        size: "small",
        variant: "ghost",
      })}
    </div>`;
  }
  const reset =
    state.overridden.length > 0
      ? button({
          attributes: { id: "experimental-features-reset" },
          icon: "refresh",
          label: t("settings.experimental.reset"),
          variant: "secondary",
        })
      : "";
  return featureRows(state) + reset;
};

/** Renders the Experimental features screen from the background's answer. */
export const experimentalFeaturesFlow = (
  status: WalletStatus,
  state: ExperimentalFeaturesState,
): string =>
  flowHeader(t("settings.experimental.title"), status) +
  flowScreen(
    "experimental-features",
    `<section class="section">
      <p class="hint">${th("settings.experimental.hint")}</p>
      ${body(state)}
    </section>`,
  );

/** Dependencies the Experimental features bindings close over. */
export type ExperimentalFeaturesUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly setState: (state: ExperimentalFeaturesState) => void;
  readonly status: () => WalletStatus;
  readonly wallet: SidepanelWallet;
};

const VALUE: Readonly<Record<Choice, boolean | null>> = { default: null, off: false, on: true };

/** Binds the per-feature choice controls and the reset button. */
export const bindExperimentalFeatures = (deps: ExperimentalFeaturesUiDeps): void => {
  const { app, render, setState, status, wallet } = deps;
  const apply = (control: HTMLButtonElement, write: () => Promise<ExperimentalFeatures>): void => {
    buttonBusy(control, true);
    void write().then(
      async (features) => {
        setState(features);
        showToast(t("settings.experimental.saved"), "success", control);
        await render(status());
      },
      (error: unknown) => {
        showToast(
          errorDetails(error, "feature flag overrides unavailable"),
          failureTone(error),
          control,
        );
        buttonBusy(control, false);
      },
    );
  };
  app?.querySelectorAll<HTMLButtonElement>("[data-flag-choice]").forEach((control) => {
    control.addEventListener("click", () => {
      const key = control.dataset["flagKey"];
      const choice = CHOICES.find((item) => item.choice === control.dataset["flagChoice"]);
      if (!key || !choice || control.getAttribute("aria-pressed") === "true") return;
      apply(control, () => wallet.setExperimentalFeature(key, VALUE[choice.choice]));
    });
  });
  const reset = app?.querySelector<HTMLButtonElement>("#experimental-features-reset");
  reset?.addEventListener("click", () => {
    apply(reset, () => wallet.resetExperimentalFeatures());
  });
};
