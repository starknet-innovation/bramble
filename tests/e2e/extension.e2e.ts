/**
 * End-to-end coverage for the built browser extension: load the MV3 package,
 * render the side panel, create a wallet, and approve a dapp connection through
 * the injected provider.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { startTestDapp } from "./test-dapp-server";

const VAULT_PASSPHRASE = "correct horse battery staple";

const createWallet = async (sidepanel: Page): Promise<void> => {
  await expect(sidepanel.getByRole("heading", { name: "Create your wallet" })).toBeVisible();
  await sidepanel.getByRole("button", { name: /Generate phrase/ }).click();

  const phraseInput = sidepanel.locator('textarea[name="mnemonic"]');
  await expect(phraseInput).not.toHaveValue("");
  const phraseWords = (await phraseInput.inputValue()).trim().split(/\s+/);
  await sidepanel.locator('input[name="verify-0"]').fill(phraseWords[2] ?? "");
  await sidepanel.locator('input[name="verify-1"]').fill(phraseWords[6] ?? "");
  await sidepanel.locator('input[name="verify-2"]').fill(phraseWords[10] ?? "");
  await sidepanel.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
  await expect(sidepanel.getByRole("button", { name: "Create wallet" })).toBeEnabled();
  await sidepanel.getByRole("button", { name: "Create wallet" }).click();
  await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible();
};

const unlockWallet = async (sidepanel: Page): Promise<void> => {
  await expect(sidepanel.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(async () => {
    const passphraseInput = sidepanel.locator('input[name="vaultPassphrase"]');
    await passphraseInput.fill(VAULT_PASSPHRASE);
    await expect(passphraseInput).toHaveValue(VAULT_PASSPHRASE);
    await sidepanel.getByRole("button", { name: "Unlock" }).click();
    await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 10_000 });
};

test("loads the built extension and renders side panel onboarding", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");

  await expect(sidepanel.getByRole("heading", { name: "Create your wallet" })).toBeVisible();
  await expect(sidepanel.getByRole("button", { name: /Generate phrase/ })).toBeEnabled();
  await expect(sidepanel.locator('select[name="networkId"]')).toHaveValue("SN_MAIN");
});

test("creates a wallet and approves a dapp connection", async ({ extension }) => {
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await createWallet(sidepanel);

  await sidepanel.getByRole("button", { name: "Lock wallet" }).click();
  await unlockWallet(sidepanel);

  const dappServer = await startTestDapp();
  try {
    const dapp = await extension.context.newPage();
    await dapp.goto(dappServer.url);
    await expect(dapp.getByTestId("provider-status")).toHaveText("mc-wallet|MC Wallet|0.1.0");

    await dapp.getByTestId("connect").click();
    await expect(dapp.getByTestId("connect-result")).toHaveText("pending");

    await sidepanel.locator('button.nav-item[data-view="activity"]').click();
    await expect(sidepanel.getByText("Connection request")).toBeVisible();
    await expect(sidepanel.getByText(dappServer.origin)).toBeVisible();
    await sidepanel.locator('[data-approval-action="approve"]').click();

    await expect(dapp.getByTestId("connect-result")).toContainText('"status":"resolved"');
    await expect(dapp.getByTestId("connect-result")).toContainText("0x");
    await dapp.getByTestId("preauth").click();
    await expect(dapp.getByTestId("preauth-result")).toHaveText("true");
  } finally {
    await dappServer.close();
  }
});
