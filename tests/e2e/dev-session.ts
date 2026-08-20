/**
 * Manual-testing launcher: opens the built extension in a headed browser on a
 * persistent profile, onboarding or unlocking it automatically so neither the
 * recovery phrase nor the vault passphrase has to be retyped.
 *
 * Run with `bun run dev:session` after `bun run build`. The browser stays open
 * until interrupted.
 *
 * Development only. The default phrase is the throwaway fixture already
 * published in this repository, so its accounts are public by construction:
 * never send real funds to an address this session shows, and never point
 * `MC_DEV_MNEMONIC` at a phrase that holds any.
 *
 * Onboarding is hard-wired to mainnet in the wallet UI, and the helper ticks
 * the mainnet acknowledgement to get through it, so a fresh profile would
 * otherwise land on SN_MAIN holding a publicly-known key. This switches to
 * Sepolia immediately after onboarding. Later runs leave the active network
 * alone, so a deliberate switch of your own survives.
 *
 * This script performs no key handling of its own — it types into the wallet UI
 * exactly as a person would, and every derivation, validation, and signature
 * stays inside the extension.
 *
 * The session drives whichever wallet surface the browser already has: Chrome
 * restores a side panel that was open when the profile was last used, and the
 * extension opens `onboarding.html` itself on a fresh install. Only when there
 * is neither does this open a tab of its own, so you are not left with a
 * full-page copy sitting beside the panel.
 *
 * Open the side panel once from the toolbar and the profile remembers it: the
 * script cannot do it for you, because `chrome.sidePanel.open()` is rejected
 * unless it is handling a real user gesture. The browser is also Playwright's
 * bundled Chromium rather than your daily Chrome, so toolbar behaviour still
 * needs a manually loaded `dist/`.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { type LoadedExtension, launchExtension } from "./extension-fixture";
import {
  IMPORT_MNEMONIC,
  importWalletFromPhrase,
  unlockWallet,
  VAULT_PASSPHRASE,
} from "./wallet-helpers";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// The profile is bound to this checkout: an unpacked extension without a
// manifest `key` takes its id from the load path, and storage is keyed per id.
// A different worktree simply onboards again on its first run; add a `key`
// locally if you want one profile shared across checkouts.
const profileDir = resolve(repoRoot, ".dev-profile");
// Long enough for the panel to boot Krusty on a cold start, short enough that
// probing for a state the wallet is not in stays cheap. Only a first run pays
// it twice, falling through both probes before it starts onboarding.
const STATE_TIMEOUT_MS = 5_000;
// How long to let the browser produce a surface of its own — a restored side
// panel or the install-time onboarding tab — before opening one ourselves.
const SURFACE_WAIT_MS = 4_000;
// The background answers as soon as Krusty is up; a cold first compile on a
// loaded machine is the slow case this covers.
const STATUS_TIMEOUT_MS = 30_000;

// `||`, not `??`: `MC_DEV_PASSPHRASE= bun run dev:session` is the ordinary way
// to clear a variable, and an empty string must fall back rather than drive the
// wizard into a minlength rejection that surfaces as a locator timeout.
const mnemonic = process.env["MC_DEV_MNEMONIC"] || IMPORT_MNEMONIC;
const passphrase = process.env["MC_DEV_PASSPHRASE"] || VAULT_PASSPHRASE;

/**
 * Moves the wallet off mainnet after onboarding created a mainnet account from
 * a publicly published phrase. Uses the background message rather than the
 * settings UI so no new selector is introduced; a failure is reported loudly
 * because staying on SN_MAIN is the unsafe outcome.
 */
const switchToSepolia = async (sidepanel: Page): Promise<void> => {
  const ok = await sidepanel.evaluate(async () => {
    const extensionGlobal = globalThis as typeof globalThis & {
      readonly chrome?: {
        readonly runtime?: {
          readonly sendMessage?: (message: unknown) => Promise<unknown>;
        };
      };
    };
    const response = (await extensionGlobal.chrome?.runtime?.sendMessage?.({
      networkId: "SN_SEPOLIA",
      type: "wallet.setActiveNetwork",
    })) as { readonly networkId?: string } | undefined;
    return response?.networkId === "SN_SEPOLIA";
  });
  console.log(
    ok
      ? "Switched to SN_SEPOLIA."
      : "WARNING: could not leave SN_MAIN — this wallet's key is public. Switch networks before use.",
  );
};

/** The home header's lock control, and so the marker that the panel is unlocked. */
const lockButton = (sidepanel: Page): Locator =>
  sidepanel.getByRole("button", { name: "Lock wallet" });

const isVisible = async (locator: Locator): Promise<boolean> => {
  try {
    await locator.first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
};

/**
 * A wallet page paired with what kind of surface it actually is.
 *
 * The URL cannot answer this: the side panel and a tab pointed at
 * `sidepanel.html` are the same address. `chrome.tabs.getCurrent()` resolves to
 * a tab for a page hosted in one and to undefined in the panel, which is the
 * only honest way to tell them apart — and the difference matters, because a
 * tab reported as the panel is exactly the duplicate this session exists to
 * avoid.
 */
type Surface = { readonly isPanel: boolean; readonly page: Page };

const classify = async (page: Page): Promise<Surface> => {
  const isPanel = await page
    .evaluate(async () => {
      const extensionGlobal = globalThis as typeof globalThis & {
        readonly chrome?: {
          readonly tabs?: { readonly getCurrent?: () => Promise<unknown> };
        };
      };
      if (!extensionGlobal.chrome?.tabs?.getCurrent) {
        return false;
      }
      return (await extensionGlobal.chrome.tabs.getCurrent()) === undefined;
    })
    .catch(() => false);
  return { isPanel, page };
};

/** Every surface belonging to the wallet, panel and tabs alike. */
const walletSurfaces = async (extension: LoadedExtension): Promise<readonly Surface[]> =>
  Promise.all(
    extension.context
      .pages()
      .filter((page) => page.url().startsWith(`chrome-extension://${extension.extensionId}/`))
      .map(classify),
  );

/**
 * The wallet surface to drive, preferring one the browser already has: the side
 * panel Chrome restores with the profile, then any wallet tab it restored or the
 * extension opened itself on a fresh install. Opening our own page is the last
 * resort, because a tab we add sits beside the panel instead of replacing it.
 *
 * Nothing here can open the panel: `chrome.sidePanel.open()` is refused unless it
 * is handling a real user gesture. Open it once from the toolbar and the profile
 * remembers it from then on.
 */
const walletSurface = async (extension: LoadedExtension): Promise<Page> => {
  const deadline = Date.now() + SURFACE_WAIT_MS;
  while (Date.now() < deadline) {
    const found = await walletSurfaces(extension);
    const existing = found.find((surface) => surface.isPanel) ?? found[0];
    if (existing) {
      return existing.page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return extension.openExtensionPage("sidepanel.html");
};

/**
 * A wallet page showing `path`, reusing what the browser already has: the panel
 * first, then a page already at that address, then a tab navigated into place,
 * and only then a new tab. The panel is never navigated away from, since it is
 * the surface the developer asked to keep.
 */
const surfaceShowing = async (extension: LoadedExtension, path: string): Promise<Page> => {
  const found = await walletSurfaces(extension);
  const atPath = (surface: Surface): boolean => surface.page.url().endsWith(`/${path}`);
  const exact = found.find((surface) => surface.isPanel && atPath(surface)) ?? found.find(atPath);
  if (exact) {
    return exact.page;
  }
  const reusableTab = found.find((surface) => !surface.isPanel);
  if (reusableTab) {
    await reusableTab.page.goto(`chrome-extension://${extension.extensionId}/${path}`);
    return reusableTab.page;
  }
  return extension.openExtensionPage(path);
};

/**
 * Leaves the panel as the only wallet surface, closing the blank starter tab and
 * any wallet tab the browser restored. Runs only when a panel exists, so a
 * profile without one keeps the surface it has.
 */
const closeRedundantSurfaces = async (extension: LoadedExtension): Promise<void> => {
  const found = await walletSurfaces(extension);
  if (!found.some((surface) => surface.isPanel)) {
    return;
  }
  const keep = new Set(found.filter((surface) => surface.isPanel).map((surface) => surface.page));
  for (const page of extension.context.pages()) {
    if (!keep.has(page)) {
      await page.close().catch(() => undefined);
    }
  }
};

/**
 * Asks the background what the wallet actually is, rather than inferring it from
 * whichever screen a restored tab happens to be showing — a completed onboarding
 * tab renders neither the gate nor the home header, which no DOM probe can tell
 * apart from a wallet that does not exist yet. Polls because the worker may
 * still be booting Krusty when the first page appears.
 */
const readStatus = async (page: Page): Promise<{ hasVault: boolean; locked: boolean }> => {
  const deadline = Date.now() + STATUS_TIMEOUT_MS;
  for (;;) {
    const status = await page.evaluate(async () => {
      const extensionGlobal = globalThis as typeof globalThis & {
        readonly chrome?: {
          readonly runtime?: {
            readonly sendMessage?: (message: unknown) => Promise<unknown>;
          };
        };
      };
      return (await extensionGlobal.chrome?.runtime?.sendMessage?.({ type: "wallet.status" })) as
        | { readonly hasVault?: boolean; readonly locked?: boolean; readonly ready?: boolean }
        | undefined;
    });
    if (status?.ready === true) {
      return { hasVault: status.hasVault === true, locked: status.locked !== false };
    }
    if (Date.now() > deadline) {
      throw new Error("the wallet background never reported a ready status");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

const main = async (): Promise<void> => {
  if (!existsSync(resolve(repoRoot, "dist/manifest.json"))) {
    throw new Error("dist/manifest.json is missing; run bun run build before bun run dev:session");
  }

  const extension = await launchExtension({
    // Reduced motion collapses the root view transitions to a cut
    // (styles-transitions.ts). Headless never animates them; a headed browser
    // does, and the transition overlay swallows clicks aimed at the button
    // underneath. Motion itself is not testable in this session — load dist/
    // in a real Chrome for that.
    args: ["--window-size=440,900", "--force-prefers-reduced-motion"],
    headless: false,
    userDataDir: profileDir,
    // Without this the window is 440px wide but the page is still laid out at
    // Playwright's emulated 1280px, which is the opposite of the point.
    viewport: null,
  });
  const status = await readStatus(await walletSurface(extension));

  if (!status.hasVault) {
    const onboarding = await surfaceShowing(extension, "onboarding.html");
    await importWalletFromPhrase(onboarding, mnemonic, passphrase);
    console.log(`Wallet onboarded into ${profileDir}.`);
    await switchToSepolia(onboarding);
  } else if (status.locked) {
    const gate = await surfaceShowing(extension, "sidepanel.html");
    await unlockWallet(gate, passphrase);
    // Report what the gate actually did. A wrong passphrase leaves the screen in
    // place, and the session is more useful left open to retype it than torn down.
    console.log(
      (await isVisible(lockButton(gate)))
        ? "Wallet unlocked."
        : "Unlock rejected — check MC_DEV_PASSPHRASE; the browser is still open.",
    );
  } else {
    console.log("Wallet already unlocked.");
  }

  await closeRedundantSurfaces(extension);

  const remaining = await walletSurfaces(extension);
  const panels = remaining.filter((surface) => surface.isPanel).length;
  console.log(`Extension id: ${extension.extensionId}`);
  console.log(
    panels > 0 && panels === remaining.length
      ? "Surfaces:     side panel only."
      : `Surfaces:     ${remaining
          .map(
            (surface) =>
              `${new URL(surface.page.url()).pathname.slice(1)}${surface.isPanel ? " (panel)" : " (tab)"}`,
          )
          .join(
            ", ",
          )}${panels === 0 ? " — open the panel once from the toolbar and the profile will restore it." : ""}`,
  );
  console.log("Ctrl-C to end the session (the profile is kept).");
  // Resolves when the browser goes away, so closing the window ends the process
  // instead of leaving it wedged with nothing to drive.
  await extension.context.waitForEvent("close", { timeout: 0 });
};

await main();
