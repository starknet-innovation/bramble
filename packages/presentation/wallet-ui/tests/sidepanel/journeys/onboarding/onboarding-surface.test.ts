/**
 * Full-page onboarding completion and side-panel handoff behavior.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  bindOnboardingCompletion,
  bindOnboardingLaunch,
  onboardingComplete,
  onboardingLaunch,
} from "../../../../src/sidepanel/journeys/onboarding/onboarding-surface";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("full-page onboarding completion", () => {
  beforeEach(() => {
    GlobalRegistrator.register();
    document.body.innerHTML = `<main id="app">${onboardingComplete()}</main>`;
  });

  afterEach(async () => {
    await GlobalRegistrator.unregister();
  });

  test("opens the current window side panel as soon as completion renders, once", async () => {
    const opened: number[] = [];
    let closed = 0;
    const browser = {
      sidePanel: {
        async open({ windowId }: { windowId: number }) {
          opened.push(windowId);
        },
      },
      windows: { WINDOW_ID_CURRENT: -2 },
    };
    const app = document.querySelector("#app");
    bindOnboardingCompletion(app, browser, () => {
      closed += 1;
    });
    await tick();
    expect(opened).toEqual([-2]);
    expect(closed).toBe(1);

    // A re-render of the same surface binds again without a second attempt.
    bindOnboardingCompletion(app, browser, () => {
      closed += 1;
    });
    await tick();
    expect(opened).toEqual([-2]);

    // After a successful handoff the surface is closing, so the action stays
    // disabled rather than inviting a second open.
    expect(document.querySelector<HTMLButtonElement>("#onboarding-open-wallet")?.disabled).toBe(
      true,
    );
  });

  test("prefers the chromium side panel when the browser offers both", async () => {
    const opened: number[] = [];
    let sidebarOpened = 0;
    bindOnboardingCompletion(document.querySelector("#app"), {
      sidePanel: {
        async open({ windowId }: { windowId: number }) {
          opened.push(windowId);
        },
      },
      sidebarAction: {
        async open() {
          sidebarOpened += 1;
        },
      },
      windows: { WINDOW_ID_CURRENT: -2 },
    });
    await tick();

    expect(opened).toEqual([-2]);
    expect(sidebarOpened).toBe(0);
  });

  test("hands off through the gecko sidebar when there is no chromium side panel", async () => {
    // Firefox exposes no `sidePanel` and no window id for it; the handoff has
    // to reach `sidebarAction`, or a completed setup would strand the user on
    // the completion page with only the toolbar hint.
    let opened = 0;
    let closed = 0;
    bindOnboardingCompletion(
      document.querySelector("#app"),
      {
        sidebarAction: {
          async open() {
            opened += 1;
          },
        },
      },
      () => {
        closed += 1;
      },
    );
    await tick();

    expect(opened).toBe(1);
    expect(closed).toBe(1);
  });

  test("shows the toolbar hint when the browser offers no panel API at all", async () => {
    bindOnboardingCompletion(document.querySelector("#app"), {});
    await tick();

    expect(document.querySelector<HTMLElement>("#onboarding-complete-result")?.textContent).toBe(
      "",
    );
    document.querySelector<HTMLButtonElement>("#onboarding-open-wallet")?.click();
    await tick();
    expect(
      document.querySelector<HTMLElement>("#onboarding-complete-result")?.textContent,
    ).toContain("toolbar");
  });

  test("closes the compact surface after the setup link opens its tab", () => {
    document.body.innerHTML = `<main id="app">${onboardingLaunch()}</main>`;
    const deferred: Array<() => void> = [];
    let closed = 0;
    bindOnboardingLaunch(
      document.querySelector("#app"),
      () => {
        closed += 1;
      },
      (task) => deferred.push(task),
    );
    const link = document.querySelector<HTMLAnchorElement>("a.onboarding-launch");
    link?.addEventListener("click", (event) => event.preventDefault());
    link?.click();
    // The close waits for the click's default action (the new tab) to start.
    expect(closed).toBe(0);
    expect(deferred).toHaveLength(1);
    deferred[0]?.();
    expect(closed).toBe(1);
  });

  test("keeps first-run setup out of compact wallet surfaces", () => {
    const markup = onboardingLaunch();
    expect(markup).toContain("Set up in a browser tab");
    expect(markup).toContain('href="onboarding.html"');
    expect(markup).toContain('target="_blank"');
    expect(markup).not.toContain("create-form");
    expect(markup).not.toContain("vaultPassphrase");
  });

  test("keeps a toolbar fallback when the side-panel API is unavailable", () => {
    bindOnboardingCompletion(document.querySelector("#app"), undefined);
    // The silent automatic attempt says nothing; the manual retry explains.
    expect(document.querySelector("#onboarding-complete-result")?.textContent).toBe("");

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
    // The automatic attempt disables the button while it runs, then restores
    // it quietly when Chrome refuses (no gesture, no panel).
    expect(button?.disabled).toBe(true);
    await tick();
    expect(button?.disabled).toBe(false);
    expect(document.querySelector("#onboarding-complete-result")?.textContent).toBe("");

    button?.click();
    expect(button?.disabled).toBe(true);
    await tick();

    expect(button?.disabled).toBe(false);
    expect(document.querySelector("#onboarding-complete-result")?.textContent).toContain(
      "browser toolbar",
    );
  });
});
