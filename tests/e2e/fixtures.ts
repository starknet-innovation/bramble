/**
 * Shared Playwright fixtures for extension E2E tests.
 */
import { test as base, expect } from "@playwright/test";
import { type LoadedExtension, launchExtension } from "./extension-fixture";

type WalletFixtures = {
  readonly extension: LoadedExtension;
};

export const test = base.extend<WalletFixtures>({
  extension: async ({ browserName }, use) => {
    if (browserName !== "chromium") {
      throw new Error("extension E2E tests must run with Chromium");
    }
    const extension = await launchExtension();
    try {
      await use(extension);
    } finally {
      await extension.close();
    }
  },
});

export { expect };
