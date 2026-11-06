/**
 * Wallet-side steps for the Speculos Ledger suite: first-run Ledger onboarding
 * through the grant tab, and a dapp signature that reaches the Ledger sign
 * takeover. The device holds the repository's PUBLIC test phrase only; the
 * addresses it must yield are pinned in `expected-accounts.ts`.
 *
 * Test-only. Nothing in `apps/` or `packages/` may import this file.
 */
import { expect, type Page } from "@playwright/test";
import type { LoadedExtension } from "../extension-fixture";
import { startTestDapp, type TestDappServer } from "../test-dapp-server";
import {
  resolveConnectionApproval,
  resolvePendingApproval,
  unlockWallet,
  VAULT_PASSPHRASE,
} from "../wallet-helpers";

/**
 * Runs first-run Ledger onboarding up to the account picker. The wallet finds
 * no granted device, opens the grant tab, and the tab's Connect button grants
 * the fake HID device. Returns the onboarding page on "Select accounts".
 */
export const onboardToLedgerPicker = async (extension: LoadedExtension): Promise<Page> => {
  const onboarding = await extension.openExtensionPage("onboarding.html");
  await onboarding.getByRole("button", { name: "Add an existing wallet" }).click();
  await onboarding.locator("#ledger-method-button").click();
  await onboarding.locator('input[name="ledgerVaultPassphrase"]').fill(VAULT_PASSPHRASE);
  await onboarding.locator('input[name="ledgerVaultPassphraseConfirm"]').fill(VAULT_PASSPHRASE);
  await onboarding.locator("#ledger-setup-button").click();

  const grantTab = extension.context.waitForEvent("page", {
    predicate: (page) => page.url().includes("/ledger-grant.html"),
    timeout: 20_000,
  });
  await onboarding.getByRole("button", { name: "Connect a Ledger" }).click();
  const grant = await grantTab;
  await grant.locator("button.grant-button").click();
  // The tab verifies the device, serves the read, then closes itself; it may
  // already be gone by the time it is polled.
  await expect
    .poll(
      async () =>
        grant.isClosed() ||
        (await grant
          .locator(".grant-status")
          .textContent()
          .then((text) => text?.includes("Ledger connected") ?? false)
          .catch(() => grant.isClosed())),
      { timeout: 60_000 },
    )
    .toBe(true);
  await expect(onboarding.getByRole("heading", { name: "Select accounts" })).toBeVisible({
    timeout: 90_000,
  });
  return onboarding;
};

/** Ticks the LedgerW OpenZeppelin account at `address` and adds it. */
export const addLedgerAccount = async (onboarding: Page, address: string): Promise<void> => {
  await onboarding.locator('[data-account-group="openzeppelin"] summary').click();
  const row = onboarding.locator(`input[data-ledger-toggle="SN_MAIN:${address}"]`);
  await row.check();
  await onboarding.locator("[data-ledger-add-selected]").click();
  await expect
    .poll(
      async () =>
        onboarding.isClosed() ||
        (await onboarding
          .getByRole("heading", { name: "You’re all set" })
          .isVisible()
          .catch(() => false)),
      { timeout: 30_000 },
    )
    .toBe(true);
};

/** Opens the side panel, unlocking it if the vault asks. */
export const openUnlockedPanel = async (extension: LoadedExtension): Promise<Page> => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  const locked = sidepanel.locator('input[name="vaultPassphrase"]');
  if (await locked.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await unlockWallet(sidepanel);
  }
  return sidepanel;
};

/** A dapp signature parked on the Ledger sign takeover. */
export type PendingLedgerSign = {
  readonly dapp: Page;
  readonly hash: string;
  readonly overlay: ReturnType<Page["locator"]>;
  readonly server: TestDappServer;
};

/**
 * Connects the test dapp, requests a SNIP-12 signature, approves it in the
 * wallet, and waits for the Ledger takeover to show the hash to compare.
 * The caller closes `server`.
 */
export const requestLedgerSignature = async (
  extension: LoadedExtension,
  sidepanel: Page,
): Promise<PendingLedgerSign> => {
  const server = await startTestDapp();
  const dapp = await extension.context.newPage();
  await dapp.goto(server.url);
  await dapp.getByTestId("connect").click();
  await resolveConnectionApproval(sidepanel, server.origin, "approve");
  await expect(dapp.getByTestId("connect-result")).toContainText('"status":"resolved"');
  await dapp.getByTestId("sign").click();
  await expect(dapp.getByTestId("sign-result")).toHaveText("pending");
  await resolvePendingApproval(sidepanel, "Sign request", server.origin, "approve");

  const overlay = sidepanel.locator(".ledger-sign-overlay");
  const connect = overlay.locator("[data-ledger-connect]");
  if (await connect.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await connect.click();
  }
  const check = overlay.locator("section.ledger-hash-check");
  await expect(check).toBeVisible({ timeout: 60_000 });
  await expect(check.locator(".context-label")).toHaveText("Hash shown on your Ledger");
  await expect(check.locator(".ledger-hash-help")).toHaveText(
    "Approve only if this matches your device, character for character.",
  );
  const shown = await check.locator("[data-copy]").getAttribute("data-copy");
  expect(shown).toMatch(/^0x[0-9a-f]{64}$/);
  return { dapp, hash: shown ?? "", overlay, server };
};

/** Normalises a hex hash for comparison with device text (no 0x, no leading zeros). */
export const comparableHash = (value: string): string => BigInt(value).toString(16).toLowerCase();

/**
 * Device screen text flattened for a substring hash comparison. The Nano pages
 * a long hash under "Hash (1/2)", "Hash (2/2)" titles; those titles are
 * dropped so the pages' digits join into the one hash the device showed.
 */
export const comparableScreen = (text: string): string =>
  text
    .replace(/\bhash\s*\(\d+\/\d+\)/gi, "")
    .replace(/\s+/g, "")
    .toLowerCase();
