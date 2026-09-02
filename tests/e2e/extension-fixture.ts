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

// BRAMBLE_E2E_LIVE_NETWORK is set by playwright.mainnet.config.ts and rejected by
// tests/e2e/global-setup.ts.
const liveNetworkAllowed = (): boolean => process.env["BRAMBLE_E2E_LIVE_NETWORK"] === "1";

// Resolver-level, not context.route, whose handler attaches after the worker may
// already have fetched; Chromium maps IP literals and honours ambient proxies.
const NETWORK_BLOCK_ARGS = [
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  "--no-proxy-server",
] as const;

const isWalletServiceWorker = (worker: Worker): boolean =>
  worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/background/index.js");

/**
 * Options for {@link launchExtension}. Every field defaults to the E2E suite's
 * behaviour: a headless browser on a throwaway profile at Playwright's standard
 * 1280x720 viewport.
 */
export type LaunchExtensionOptions = {
  /** Extra Chromium switches appended to the extension-loading ones. */
  readonly args?: readonly string[];
  readonly headless?: boolean;
  /**
   * A profile directory to reuse. When supplied it is treated as the caller's
   * own: it is neither created fresh nor removed on close, so extension storage
   * (and therefore an onboarded vault) survives across launches.
   */
  readonly userDataDir?: string;
  /**
   * Pass `null` to size pages by the real browser window instead of Playwright's
   * emulated viewport, which otherwise lays every page out at 1280x720 however
   * small the window is.
   */
  readonly viewport?: null;
};

/**
 * Launches bundled Chromium with the built extension loaded from dist/.
 *
 * Throws if the extension's background service worker never appears, which is
 * how a missing or broken `dist/` surfaces.
 */
export const launchExtension = async (
  options: LaunchExtensionOptions = {},
): Promise<LoadedExtension> => {
  const ownedProfile = options.userDataDir === undefined;
  const userDataDir = options.userDataDir ?? (await mkdtemp(resolve(tmpdir(), "bramble-e2e-")));
  const context = await chromium.launchPersistentContext(userDataDir, {
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      ...(options.args ?? []),
      ...(liveNetworkAllowed() ? [] : NETWORK_BLOCK_ARGS),
    ],
    channel: "chromium",
    headless: options.headless ?? true,
    // Spread conditionally because `exactOptionalPropertyTypes` forbids
    // assigning `undefined` to an optional property (TS2379). Playwright itself
    // treats an absent and an undefined viewport identically.
    ...(options.viewport === null ? { viewport: null } : {}),
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
    if (ownedProfile) {
      await rm(userDataDir, { force: true, recursive: true });
    }
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
