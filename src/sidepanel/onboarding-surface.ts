/**
 * Dedicated full-page onboarding completion UI and Chrome side-panel handoff.
 */
import { icon } from "./icons";

/**
 * Minimal Chrome surface used after setup. Opening is user-gesture gated and
 * failure leaves the completion page intact with actionable guidance.
 */
export type OnboardingCompletionBrowser = {
  readonly sidePanel?: {
    readonly open: (options: { readonly windowId: number }) => Promise<void>;
  };
  readonly windows?: {
    readonly WINDOW_ID_CURRENT: number;
  };
};

/**
 * Completion screen rendered when onboarding.html observes an existing vault.
 * It contains no account data or secret material.
 */
export const onboardingComplete = (): string => `
  <main class="screen gate onboarding-complete">
    <div class="gate-brand onboarding-complete-mark">${icon("check")}</div>
    <div class="gate-head">
      <p class="eyebrow">Setup complete</p>
      <h1>Your wallet is ready</h1>
      <p class="lede">MC Wallet is encrypted on this device. Continue in the side panel to deploy your account, receive assets, or connect to an app.</p>
    </div>
    <div class="onboarding-complete-actions">
      <button id="onboarding-open-wallet" type="button">Open wallet</button>
      <p id="onboarding-complete-result" class="hint" role="status"></p>
    </div>
  </main>`;

/**
 * Hands a completed full-page setup into the wallet side panel. Chrome API
 * denial fails visibly and never changes wallet state.
 */
export const bindOnboardingCompletion = (
  app: Element | null,
  browser: OnboardingCompletionBrowser | undefined,
  closeSurface: () => void = () => undefined,
): void => {
  const button = app?.querySelector<HTMLButtonElement>("#onboarding-open-wallet");
  const result = app?.querySelector<HTMLElement>("#onboarding-complete-result");
  button?.addEventListener("click", () => {
    const windowId = browser?.windows?.WINDOW_ID_CURRENT;
    const sidePanel = browser?.sidePanel;
    if (typeof windowId !== "number" || !sidePanel?.open) {
      if (result) {
        result.textContent = "Open MC Wallet from the browser toolbar to continue.";
      }
      return;
    }
    button.disabled = true;
    if (result) {
      result.textContent = "Opening the wallet…";
    }
    void sidePanel.open({ windowId }).then(closeSurface, () => {
      button.disabled = false;
      if (result) {
        result.textContent = "Open MC Wallet from the browser toolbar to continue.";
      }
    });
  });
};
