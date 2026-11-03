/**
 * Imports the sncast account into a fresh extension profile and points the
 * wallet at the dedicated RPC. The signing key is typed into the audited
 * import field and cleared afterwards. It is not written to a log by this
 * module; a failed Playwright step can still echo the value it typed.
 */

import { sameFelt } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { LoadedExtension } from "../../e2e/extension-fixture";
import { sendRuntimeMessage, unlockWallet, VAULT_PASSPHRASE } from "../../e2e/wallet-helpers";
import type { LocalMainnetAccount } from "../local-mainnet-account";

const redact = (text: string, key: string): string => text.split(key).join("[redacted]");

const activeAddress = async (page: Page): Promise<string | null> => {
  const response = await sendRuntimeMessage<{
    readonly accounts?: readonly { readonly address: string; readonly id: string }[];
    readonly activeAccountId?: string | null;
  }>(page, { type: "wallet.status" });
  return (
    response?.accounts?.find((account) => account.id === response.activeAccountId)?.address ?? null
  );
};

const importKey = async (onboarding: Page, account: LocalMainnetAccount): Promise<void> => {
  await onboarding.locator("#add-existing-button").click();
  await onboarding.locator("#key-method-button").click();
  await onboarding.locator('select[name="importKeyContractType"]').selectOption("openzeppelin");
  const keyInput = onboarding.locator('textarea[name="importKeyRaw"]');
  try {
    await keyInput.fill(account.privateKey);
    await expect(onboarding.locator("#import-key-continue")).toBeEnabled();
    await onboarding.locator("#import-key-continue").click();
    await onboarding.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
    await onboarding.locator('input[name="vaultPassphraseConfirm"]').fill(VAULT_PASSPHRASE);
    await expect(onboarding.locator("#password-continue-button")).toBeEnabled();
    await onboarding.locator("#password-continue-button").click();
    await expect
      .poll(
        async () =>
          onboarding.isClosed() ||
          (await onboarding
            .getByRole("heading", { name: /all set/ })
            .isVisible()
            .catch(() => false)),
        { timeout: 30_000 },
      )
      .toBe(true);
  } catch (error) {
    const status = await onboarding
      .locator("#import-key-result, #passphrase-result")
      .allTextContents()
      .catch(() => []);
    const detail = redact(status.join(" ").trim(), account.privateKey);
    const message =
      error instanceof Error ? redact(error.message, account.privateKey) : "Import failed";
    throw new Error(detail.length > 0 ? `${message} ${detail}` : message);
  } finally {
    if ((await keyInput.count().catch(() => 0)) > 0) {
      await keyInput.fill("").catch(() => undefined);
    }
  }
};

const setDedicatedRpc = async (page: Page, rpcUrl: string): Promise<void> => {
  const response = await sendRuntimeMessage<{ readonly ok?: boolean }>(page, {
    networkId: "SN_MAIN",
    rpcUrl,
    type: "wallet.setRpcOverride",
  });
  if (response?.ok !== true) {
    throw new Error("Could not set the dedicated mainnet RPC on the wallet.");
  }
};

/**
 * Onboards the funded account, pins the dedicated RPC, and checks the imported
 * address matches the sncast account before any transaction is possible.
 */
export const openFundedWallet = async (
  extension: LoadedExtension,
  account: LocalMainnetAccount,
): Promise<Page> => {
  const onboarding = await extension.openExtensionPage("onboarding.html");
  await importKey(onboarding, account);
  const page = await extension.openExtensionPage("sidepanel.html");
  if (
    await page
      .locator('input[name="vaultPassphrase"]')
      .isVisible()
      .catch(() => false)
  ) {
    await unlockWallet(page);
  }
  await expect(page.locator("#account-trigger")).toBeVisible({ timeout: 20_000 });
  const imported = await activeAddress(page);
  if (imported === null || !sameFelt(imported, account.address)) {
    throw new Error(
      `Imported ${imported ?? "no"} account, not the sncast account ${account.address}. The key's OpenZeppelin address does not match the funded account, so nothing was sent.`,
    );
  }
  await setDedicatedRpc(page, account.rpcUrl);
  await page.reload();
  await expect(page.locator("#account-trigger")).toBeVisible();
  return page;
};

/**
 * Waits until the home row for `token` shows `formatted`, the chain's own
 * decimal spelling. The row is the public balance when the account has no
 * private balance.
 */
export const expectDisplayedBalance = async (
  page: Page,
  token: TokenConfig,
  formatted: string,
): Promise<void> => {
  const key = `token:${token.id}:balance`;
  await expect
    .poll(async () => page.locator(`[data-live-key="${key}"]`).getAttribute("data-live-value"), {
      intervals: [1_000, 2_000, 4_000],
      timeout: 60_000,
    })
    .toBe(formatted);
};
