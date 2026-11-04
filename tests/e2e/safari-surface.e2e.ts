/**
 * The Safari build (#389) in Chromium, as close to Safari's extension API
 * surface as Chromium allows. `dist-safari` declares no `sidePanel` permission,
 * so `chrome.sidePanel` is absent, as it is on Safari, and the pages run with
 * WebHID, WebUSB and Web Bluetooth removed, as Safari has none of them.
 *
 * It proves the popup-only behaviour end to end: the toolbar popup is set for
 * the default "side panel" choice (otherwise the toolbar button opens nothing),
 * Settings hides the request-display choice, and "Add account" in the popup
 * opens the chooser instead of the "Ledger needs the side panel" dead end.
 *
 * What it cannot prove is Safari itself: WebKit's MV3 runtime, the Xcode
 * wrapper and Safari's storage lockdown are outside Chromium. RELEASING.md
 * lists the manual Safari smoke test.
 */
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { type LoadedExtension, launchExtension } from "./extension-fixture";
import { createWalletFromGeneratedPhrase } from "./wallet-helpers";

const SAFARI_DIST = "dist-safari";

const withoutLedgerTransports = (): void => {
  for (const name of ["bluetooth", "hid", "usb"]) {
    Object.defineProperty(Navigator.prototype, name, { configurable: true, value: undefined });
  }
};

let extension: LoadedExtension;

test.beforeEach(async () => {
  // CI builds it before the suite (`bun run build:safari`); a missing build is
  // a failure, never a skip, so the Safari lane can't silently go untested.
  expect(existsSync(`${SAFARI_DIST}/manifest.json`), "run `bun run build:safari` first").toBe(true);
  extension = await launchExtension({ distDirectory: SAFARI_DIST });
  await extension.context.addInitScript(withoutLedgerTransports);
});

test.afterEach(async () => {
  await extension.close();
});

test("the toolbar opens the popup when the browser has no panel API", async () => {
  const toolbar = await extension.serviceWorker.evaluate(async () => {
    const api = (
      globalThis as typeof globalThis & {
        readonly chrome: {
          readonly action: { readonly getPopup: (details: object) => Promise<string> };
          readonly sidePanel?: unknown;
        };
      }
    ).chrome;
    return { hasSidePanel: api.sidePanel !== undefined };
  });
  expect(toolbar.hasSidePanel).toBe(false);
  await expect
    .poll(() =>
      extension.serviceWorker.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            readonly chrome: {
              readonly action: { readonly getPopup: (details: object) => Promise<string> };
            };
          }
        ).chrome.action.getPopup({}),
      ),
    )
    .toMatch(/\/popup\.html$/);
});

test("the popup is the only surface: no request-display choice, no Ledger dead end", async () => {
  const wallet = await extension.openExtensionPage("sidepanel.html");
  await createWalletFromGeneratedPhrase(wallet);
  await wallet.close();

  const popup = await extension.openExtensionPage("popup.html");
  await expect(popup.locator("body")).toHaveClass(/panelless-browser/);
  await expect(popup.getByRole("button", { name: "Lock wallet" })).toBeVisible();

  await popup.locator('[data-view="settings"]').first().click();
  const access = popup.getByRole("group", { name: "Access and permissions" });
  await expect(access.getByRole("button", { name: "Connected sites" })).toBeVisible();
  // In the markup, hidden by the panelless mark: present, never shown.
  await expect(popup.locator('[data-view="request-settings"]')).toHaveCount(1);
  await expect(popup.locator('[data-view="request-settings"]')).toBeHidden();

  await popup.locator('[data-view="home"]').first().click();
  await popup.locator("#account-trigger").click();
  await popup.getByRole("button", { name: "Add account" }).click();
  await expect(popup.getByText("Add a new account")).toBeVisible();
  await expect(popup.getByText("Ledger needs the side panel")).toHaveCount(0);
  await expect(popup.getByRole("button", { name: /^Ledger account/ })).toHaveCount(0);
});
