/**
 * Dedicated full-page onboarding completion UI and Chrome side-panel handoff.
 */
import { actionLink, button } from "@bramble/ui-kit/controls";
import { icon } from "../../shared/icons";

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
 * Compact handoff shown when a first-run user opens the toolbar surface.
 * Wallet setup never runs inside the popup or side panel: the explicit link
 * opens the dedicated extension tab where security decisions have stable room.
 */
export const onboardingLaunch = (): string => `
  <main class="screen flow gate onboarding-gate">
    <div class="gate-brand">${icon("wallet")}</div>
    <div class="gate-head">
      <p class="eyebrow">Wallet setup</p>
      <h1>Set up in a browser tab</h1>
      <p class="lede">Bramble uses a full-screen setup so every recovery, protection, and account choice stays clear.</p>
    </div>
    <div class="onboarding-gate-actions">
      ${actionLink({
        href: "onboarding.html",
        label: "Open full-screen setup",
        target: "_blank",
      })}
      <p class="onboarding-local-note">${icon("lock")} Encrypted locally on this device</p>
    </div>
  </main>`;

/**
 * Completion screen rendered when onboarding.html observes an existing vault.
 * It contains no account data or secret material.
 */
export const onboardingComplete = (): string => `
  <main class="screen flow gate onboarding-complete">
    <div class="gate-brand onboarding-complete-mark">${icon("check")}</div>
    <div class="gate-head">
      <p class="eyebrow">Setup complete</p>
      <h1>You’re all set</h1>
      <p class="lede">Your account is ready in Bramble. Open the side panel to receive assets, connect to an app, or deploy when you’re ready.</p>
    </div>
    <div class="onboarding-complete-details">
      <div class="onboarding-complete-detail">${icon("lock")} <span>Vault encrypted locally on this device</span></div>
      <div class="onboarding-complete-detail">${icon("shield")} <span>Recovery and signing material stay behind the wallet boundary</span></div>
    </div>
    <div class="onboarding-complete-actions">
      ${button({ attributes: { id: "onboarding-open-wallet" }, label: "Open Bramble" })}
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
        result.textContent = "Open Bramble from the browser toolbar to continue.";
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
        result.textContent = "Open Bramble from the browser toolbar to continue.";
      }
    });
  });
};
