/**
 * Browser boundary for opening the dedicated first-install onboarding tab.
 */

/**
 * Minimal Chrome APIs needed to launch onboarding without reading tab data.
 */
export type OnboardingSurfaceBrowser = {
  readonly runtime?: {
    readonly getURL?: (path: string) => string;
  };
  readonly tabs?: {
    readonly create?: (properties: {
      readonly active: boolean;
      readonly url: string;
    }) => Promise<unknown>;
  };
};

/**
 * Opens the full-page onboarding only for a fresh install. Updates never
 * interrupt an existing wallet, and browser failures leave the side-panel
 * onboarding fallback available.
 */
export const openOnboardingOnInstall = async (
  browser: OnboardingSurfaceBrowser | undefined,
  reason: string | undefined,
): Promise<void> => {
  const runtime = browser?.runtime;
  const tabs = browser?.tabs;
  if (reason !== "install" || !runtime?.getURL || !tabs?.create) {
    return;
  }
  try {
    await tabs.create({ active: true, url: runtime.getURL("onboarding.html") });
  } catch {
    // First-install launch is convenience only; toolbar onboarding still works.
  }
};
