/**
 * Full-page onboarding completion and side-panel handoff behavior.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  bindOnboardingCompletion,
  onboardingComplete,
} from "../../src/sidepanel/onboarding-surface";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("full-page onboarding completion", () => {
  beforeEach(() => {
    GlobalRegistrator.register();
    document.body.innerHTML = `<main id="app">${onboardingComplete()}</main>`;
  });

  afterEach(() => {
    GlobalRegistrator.unregister();
  });

  test("opens the current window side panel from the completion action", async () => {
    const opened: number[] = [];
    bindOnboardingCompletion(document.querySelector("#app"), {
      sidePanel: {
        async open({ windowId }) {
          opened.push(windowId);
        },
      },
      windows: { WINDOW_ID_CURRENT: -2 },
    });

    document.querySelector<HTMLButtonElement>("#onboarding-open-wallet")?.click();
    await Promise.resolve();

    expect(opened).toEqual([-2]);
  });

  test("keeps a toolbar fallback when the side-panel API is unavailable", () => {
    bindOnboardingCompletion(document.querySelector("#app"), undefined);

    document.querySelector<HTMLButtonElement>("#onboarding-open-wallet")?.click();

    expect(document.querySelector("#onboarding-complete-result")?.textContent).toContain(
      "browser toolbar",
    );
  });

  test("restores the action with guidance when Chrome rejects the handoff", async () => {
    bindOnboardingCompletion(document.querySelector("#app"), {
      sidePanel: {
        async open() {
          throw new Error("side panel unavailable");
        },
      },
      windows: { WINDOW_ID_CURRENT: -2 },
    });

    const button = document.querySelector<HTMLButtonElement>("#onboarding-open-wallet");
    button?.click();
    expect(button?.disabled).toBe(true);
    await tick();

    expect(button?.disabled).toBe(false);
    expect(document.querySelector("#onboarding-complete-result")?.textContent).toContain(
      "browser toolbar",
    );
  });
});
