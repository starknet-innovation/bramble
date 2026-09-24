/**
 * Dedicated full-page onboarding completion UI and Chrome side-panel handoff.
 */

import { BRAMBLE_MARK } from "@bramble/ui-kit/brand-mark";
import { actionLink, button } from "@bramble/ui-kit/controls";
import { icon } from "../../shared/icons";

/**
 * Minimal browser surface used after setup. Opening is user-gesture gated and
 * failure leaves the completion page intact with actionable guidance.
 *
 * Two panel APIs appear here because the browsers name the same surface
 * differently: Chromium opens it through `sidePanel` and needs the window to
 * target, Firefox through `sidebarAction` which always opens in the active
 * window and takes no argument. Both are optional, and a runtime offering
 * neither falls back to the toolbar guidance below rather than failing.
 */
export type OnboardingCompletionBrowser = {
  readonly sidePanel?: {
    readonly open: (options: { readonly windowId: number }) => Promise<void>;
  };
  readonly sidebarAction?: {
    readonly open: () => Promise<void>;
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
    <div class="gate-brand">${BRAMBLE_MARK}</div>
    <div class="gate-head">
      <p class="eyebrow">Wallet setup</p>
      <h1>Set up in a browser tab</h1>
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
      <h1>You’re all set</h1>
    </div>
    <div class="onboarding-complete-actions">
      ${button({ attributes: { id: "onboarding-open-wallet" }, label: "Open Bramble" })}
      <p id="onboarding-complete-result" class="hint" role="status"></p>
    </div>
  </main>`;

/**
 * Closes the compact surface once its "Open full-screen setup" link has
 * opened the dedicated tab, so the side panel does not sit beside setup
 * showing a stale handoff. The close is deferred past the click's default
 * action so the new tab is already opening when the panel goes.
 */
export const bindOnboardingLaunch = (
  app: Element | null,
  closeSurface: () => void,
  defer: (task: () => void) => void = (task) => setTimeout(task, 0),
): void => {
  const link = app?.querySelector<HTMLAnchorElement>('a.onboarding-launch[target="_blank"]');
  link?.addEventListener("click", () => defer(closeSurface));
};

const TOOLBAR_FALLBACK = "Open Bramble from the browser toolbar to continue.";

/**
 * Hands a completed full-page setup into the wallet side panel. Chrome opens
 * a side panel only inside a user gesture, so the attempt runs once as soon
 * as the completion screen renders — still within the activation of the
 * click that finished setup — and the button stays as the retry. Chrome API
 * denial fails visibly and never changes wallet state.
 */
export const bindOnboardingCompletion = (
  app: Element | null,
  browser: OnboardingCompletionBrowser | undefined,
  closeSurface: () => void = () => undefined,
): void => {
  const button = app?.querySelector<HTMLButtonElement>("#onboarding-open-wallet");
  const result = app?.querySelector<HTMLElement>("#onboarding-complete-result");
  if (!button) {
    return;
  }
  const open = (announceFallback: boolean): void => {
    const windowId = browser?.windows?.WINDOW_ID_CURRENT;
    const sidePanel = browser?.sidePanel;
    const sidebarAction = browser?.sidebarAction;
    // Chromium needs a window id to open its side panel; Firefox's sidebar
    // takes none. Missing either API, or the id Chromium's path requires, is
    // the toolbar-guidance case rather than an error.
    const raise =
      typeof windowId === "number" && sidePanel?.open
        ? () => sidePanel.open({ windowId })
        : sidebarAction?.open
          ? () => sidebarAction.open()
          : null;
    if (!raise) {
      if (result && announceFallback) {
        result.textContent = TOOLBAR_FALLBACK;
      }
      return;
    }
    button.disabled = true;
    if (result) {
      result.textContent = "Opening the wallet…";
    }
    void raise().then(closeSurface, () => {
      button.disabled = false;
      if (result) {
        result.textContent = announceFallback ? TOOLBAR_FALLBACK : "";
      }
    });
  };
  button.addEventListener("click", () => open(true));
  // One automatic attempt per surface, tracked on the mount so re-renders of
  // the completion scene do not retry (and flash the button) on every refresh.
  const mount = app instanceof HTMLElement ? app : null;
  if (mount && mount.dataset["onboardingAutoOpened"] !== "true") {
    mount.dataset["onboardingAutoOpened"] = "true";
    open(false);
  }
};
