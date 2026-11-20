/**
 * The language screen: follow the browser, or pin one shipped language.
 *
 * The whole panel re-rendering in the chosen language is the confirmation, so
 * a successful change shows no toast; only a failed write says so.
 */
import { LOCALES } from "@bramble/core/i18n";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { segmentedControl } from "@bramble/ui-kit/controls";
import { isLanguagePreference } from "@bramble/wallet-model/preferences";
import { LANGUAGE_NAMES, t } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import { buttonBusy, errorDetails, showToast } from "../../shared/dom";
import { flowHeader, flowScreen } from "../../shared/parts";
import type { SettingsUiDeps } from "./settings-ui";

const CHOICES = ["auto", ...LOCALES] as const;

/** The settings-row value: the pinned language's own name, or "Browser". */
export const languageRowValue = (preferences: WalletPreferences | null): string => {
  const language = preferences?.language ?? "auto";
  return language === "auto" ? t("settings.language.auto") : LANGUAGE_NAMES[language];
};

/** Renders the language choice on its own screen. */
export const languageFlow = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  flowHeader(t("settings.language.title"), status) +
  flowScreen(
    "language",
    `<section class="section">
      ${segmentedControl(
        t("settings.language.title"),
        CHOICES.map((choice) => ({
          attributes: { "data-language": choice },
          label: choice === "auto" ? t("settings.language.auto") : LANGUAGE_NAMES[choice],
          pressed: (preferences?.language ?? "auto") === choice,
        })),
      )}
    </section>`,
  );

/** Binds the language choices; a pressed choice is a no-op. */
export const bindLanguage = (deps: SettingsUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-language]").forEach((button) => {
    button.addEventListener("click", () => {
      const language = button.dataset["language"];
      if (!isLanguagePreference(language) || button.getAttribute("aria-pressed") === "true") {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.setDisplay({ language }).then(
        async () => {
          await deps.render(await deps.refresh());
        },
        (error: unknown) => {
          showToast(errorDetails(error, t("settings.language.saveFailed")), "error", button);
          buttonBusy(button, false);
        },
      );
    });
  });
};
