/**
 * Shared side-panel helpers for extension E2E tests.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { BACKUP_VERIFY_POSITIONS } from "../../src/sidepanel/backup-verify";

export const VAULT_PASSPHRASE = "correct horse battery staple";

/** Valid 12-word phrase used to exercise the import-wallet path without generation. */
export const IMPORT_MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

const phraseWords = (phrase: string): readonly string[] =>
  phrase.trim().split(/\s+/).filter(Boolean);

const acknowledgeMainnetIfPresent = async (sidepanel: Page): Promise<void> => {
  const checkbox = sidepanel.locator('input[name="mainnetAck"]');
  if ((await checkbox.count()) === 0 || !(await checkbox.isVisible())) {
    return;
  }
  await checkbox.check();
};

/**
 * Fills backup-verification inputs using the same positions as onboarding UI.
 */
export const fillBackupVerify = async (sidepanel: Page, phrase: string): Promise<void> => {
  const words = phraseWords(phrase);
  await expect(sidepanel.locator("#backup-verify")).toBeVisible();
  for (const [index, position] of BACKUP_VERIFY_POSITIONS.entries()) {
    await sidepanel.locator(`input[name="verify-${index}"]`).fill(words[position - 1] ?? "");
  }
  await expect(sidepanel.locator("#verify-result")).toHaveText("Confirmed");
};

/**
 * Creates a wallet by generating a fresh recovery phrase and confirming backup words.
 */
export const createWalletFromGeneratedPhrase = async (sidepanel: Page): Promise<void> => {
  await expect(sidepanel.getByRole("heading", { name: "Create your wallet" })).toBeVisible();
  await sidepanel.getByRole("button", { name: /Generate phrase/ }).click();

  const phraseInput = sidepanel.locator('textarea[name="mnemonic"]');
  await expect(phraseInput).not.toHaveValue("");
  const phrase = await phraseInput.inputValue();
  await fillBackupVerify(sidepanel, phrase);
  await sidepanel.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
  await acknowledgeMainnetIfPresent(sidepanel);
  await sidepanel.getByRole("button", { name: "Create wallet" }).click();
  await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible();
};

/**
 * Creates a wallet by pasting an existing recovery phrase (skips backup verification).
 */
export const importWalletFromPhrase = async (sidepanel: Page, mnemonic: string): Promise<void> => {
  await expect(sidepanel.getByRole("heading", { name: "Create your wallet" })).toBeVisible();
  await sidepanel.locator('textarea[name="mnemonic"]').fill(mnemonic);
  await sidepanel.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
  await expect(sidepanel.locator("#backup-verify")).toBeHidden();
  await acknowledgeMainnetIfPresent(sidepanel);
  await expect(sidepanel.getByRole("button", { name: "Create wallet" })).toBeEnabled();
  await sidepanel.getByRole("button", { name: "Create wallet" }).click();
  await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible();
};

/**
 * Unlocks a locked wallet in the side panel.
 */
export const unlockWallet = async (sidepanel: Page): Promise<void> => {
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

/**
 * Opens the activity view and handles a pending connection approval.
 */
export const resolveConnectionApproval = async (
  sidepanel: Page,
  origin: string,
  action: "approve" | "deny",
): Promise<void> => {
  await resolvePendingApproval(sidepanel, "Connection request", origin, action);
};

/**
 * Opens the activity view and resolves a pending approval identified by its
 * card eyebrow (for example "Connection request", "Sign request", or
 * "Transaction request"), then approves or denies it.
 */
export const resolvePendingApproval = async (
  sidepanel: Page,
  eyebrow: string,
  origin: string,
  action: "approve" | "deny",
): Promise<void> => {
  await sidepanel.locator('button.nav-item[data-view="activity"]').click();
  await expect(sidepanel.getByText(eyebrow)).toBeVisible();
  await expect(sidepanel.getByText(origin)).toBeVisible();
  await sidepanel.locator(`[data-approval-action="${action}"]`).click();
};
