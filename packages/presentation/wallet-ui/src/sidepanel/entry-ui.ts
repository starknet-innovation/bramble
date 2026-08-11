/**
 * Small DOM effects used by the side-panel entrypoint.
 */
import type { ThemeChoice } from "@mc-wallet/settings/preferences";
import { applySkin } from "@mc-wallet/ui-kit/skin";
import { colorSchemeForChoice, skinForChoice } from "@mc-wallet/ui-kit/theme";
import { isWalletView, type WalletView } from "./parts";

/**
 * Binds declarative forward and back navigation controls in a rendered shell.
 */
export const bindEntryNavigation = (
  root: Element | null,
  navigate: (view: WalletView) => void,
  goBack: () => void,
): void => {
  root?.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((control) => {
    control.addEventListener("click", () => {
      const view = control.dataset["view"];
      if (isWalletView(view)) {
        navigate(view);
      }
    });
  });
  root?.querySelectorAll<HTMLButtonElement>("[data-nav-back]").forEach((control) => {
    control.addEventListener("click", goBack);
  });
};

/**
 * Applies a changed theme and returns its resolved name for memoization.
 */
export const applyEntryTheme = (
  choice: ThemeChoice,
  previousSkinName: string,
  root: HTMLElement,
): string => {
  const skin = skinForChoice(choice);
  if (skin.name !== previousSkinName) {
    root.style.setProperty("color-scheme", colorSchemeForChoice(choice));
    applySkin(skin, root);
  }
  return skin.name;
};
