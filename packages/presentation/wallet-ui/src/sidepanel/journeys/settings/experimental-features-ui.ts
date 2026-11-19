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

const CHOICES: readonly { readonly choice: Choice; readonly label: string }[] = [
  { choice: "default", label: "Default" },
  { choice: "on", label: "On" },
  { choice: "off", label: "Off" },
];

const choiceOf = (features: ExperimentalFeatures, key: string): Choice => {
  if (!features.overridden.includes(key)) return "default";
  return features.flags[key] ? "on" : "off";
};

const stateLine = (features: ExperimentalFeatures, key: string): string => {
  if (features.killed.includes(key)) return "Off · turned off by Bramble";
  const value = features.flags[key] ? "On" : "Off";
  return features.overridden.includes(key) ? `${value} · your choice` : `${value} · default`;
};

const featureRows = (features: ExperimentalFeatures): string =>
  features.overridable.length === 0
    ? emptyState("This version has no features you can change.")
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
                  label,
                  pressed: !killed && current === choice,
                })),
              )}
            </li>`;
        })
        .join("")}</ul>`;

const body = (state: ExperimentalFeaturesState): string => {
  if (state === "loading") return emptyState("Loading experimental features…");
  if (state === "error") {
    return `<div class="panel-error">
      ${emptyState("Couldn't load experimental features.")}
      ${button({
        attributes: {
          "aria-label": "Retry loading experimental features",
          "data-reload-balances": true,
        },
        icon: "refresh",
        label: "Try again",
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
          label: "Reset all",
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
  flowHeader("Experimental features", status) +
  flowScreen(
    "experimental-features",
    `<section class="section">
      <p class="hint">These switch wallet features on or off on this device. A changed feature may not work as expected. A feature Bramble turns off stays off.</p>
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
        showToast("Saved", "success", control);
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
