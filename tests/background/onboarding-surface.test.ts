/**
 * Full-page onboarding launch policy: install opens once, updates and missing
 * browser capabilities remain non-fatal.
 */
import { describe, expect, test } from "bun:test";
import { openOnboardingOnInstall } from "../../apps/extension/src/background/onboarding-surface";

describe("full-page onboarding launch", () => {
  test("opens the extension onboarding tab on a fresh install", async () => {
    const opened: { readonly active: boolean; readonly url: string }[] = [];

    await openOnboardingOnInstall(
      {
        runtime: {
          getURL: (path) => `chrome-extension://wallet/${path}`,
        },
        tabs: {
          async create(properties) {
            opened.push(properties);
          },
        },
      },
      "install",
    );

    expect(opened).toEqual([{ active: true, url: "chrome-extension://wallet/onboarding.html" }]);
  });

  test("does not interrupt users after an extension update", async () => {
    let opens = 0;

    await openOnboardingOnInstall(
      {
        runtime: { getURL: (path) => path },
        tabs: {
          async create() {
            opens += 1;
          },
        },
      },
      "update",
    );

    expect(opens).toBe(0);
  });

  test("fails open to side-panel onboarding when Chrome rejects tab creation", async () => {
    await expect(
      openOnboardingOnInstall(
        {
          runtime: { getURL: (path) => path },
          tabs: {
            async create() {
              throw new Error("tabs unavailable");
            },
          },
        },
        "install",
      ),
    ).resolves.toBeUndefined();
  });
});
