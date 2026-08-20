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
 * Two behaviours differ from a hand-loaded Chrome: the side panel is opened as
 * an ordinary tab (nothing may click the toolbar action), and the browser is
 * Playwright's bundled Chromium rather than your daily Chrome. Toolbar and
 * native side-panel behaviour still need a manually loaded `dist/`.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { launchExtension } from "./extension-fixture";
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
  const sidepanel = await extension.openExtensionPage("sidepanel.html");

  // Locked first: a launch always starts locked, because the unlock session
  // lives in the extension's session storage area and dies with the browser.
  // The unlocked branch is kept for the day that stops being true, rather than
  // paid for as a doomed probe on every run.
  if (await isVisible(sidepanel.locator("#unlock-form"))) {
    await unlockWallet(sidepanel, passphrase);
    // Report what the gate actually did. A wrong passphrase leaves the screen
    // in place, and the session is more useful left open to retype it than
    // torn down.
    console.log(
      (await isVisible(lockButton(sidepanel)))
        ? "Wallet unlocked."
        : "Unlock rejected — check MC_DEV_PASSPHRASE; the browser is still open.",
    );
  } else if (await isVisible(lockButton(sidepanel))) {
    console.log("Wallet already unlocked.");
  } else {
    await importWalletFromPhrase(sidepanel, mnemonic, passphrase);
    console.log(`Wallet onboarded into ${profileDir}.`);
    await switchToSepolia(sidepanel);
  }

  console.log(`Extension id: ${extension.extensionId}`);
  console.log(`Side panel:   chrome-extension://${extension.extensionId}/sidepanel.html`);
  console.log("Ctrl-C to end the session (the profile is kept).");
  // Resolves when the browser goes away, so closing the window ends the process
  // instead of leaving it wedged with nothing to drive.
  await extension.context.waitForEvent("close", { timeout: 0 });
};

await main();
