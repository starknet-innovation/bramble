/**
 * Playwright helpers for loading the built MV3 extension in an isolated
 * Chromium profile.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, type Page, type Worker } from "@playwright/test";

/**
 * Loaded extension handles exposed to E2E tests.
 */
export type LoadedExtension = {
  readonly close: () => Promise<void>;
  readonly context: BrowserContext;
  readonly extensionId: string;
  readonly openExtensionPage: (path: string) => Promise<Page>;
  readonly serviceWorker: Worker;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const distPath = resolve(repoRoot, "dist");

const isWalletServiceWorker = (worker: Worker): boolean =>
  worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/background/index.js");

/**
 * Launches bundled Chromium with the built extension loaded from dist/.
 */
export const launchExtension = async (): Promise<LoadedExtension> => {
  const userDataDir = await mkdtemp(resolve(tmpdir(), "mc-wallet-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    args: [`--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
    channel: "chromium",
    headless: true,
  });
  const serviceWorker =
    context.serviceWorkers().find(isWalletServiceWorker) ??
    (await context.waitForEvent("serviceworker", {
      predicate: isWalletServiceWorker,
    }));
  const extensionId = new URL(serviceWorker.url()).host;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await context.close();
    await rm(userDataDir, { force: true, recursive: true });
  };

  return {
    close,
    context,
    extensionId,
    openExtensionPage: async (path) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      return page;
    },
    serviceWorker,
  };
};
