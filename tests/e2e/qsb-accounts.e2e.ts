/**
 * QSB vaults (QSB accounts) in the built extension, end to end through the
 * real background: Krusty generates the 24-word phrase, each account's journal
 * is written to its own encrypted key, and the panel shows the phrase only
 * after the wallet password is typed again. A generated account becomes ready
 * once three of its words are retyped; an imported phrase stays read-only; and
 * both still read as such after the panel reloads, so their journals were
 * written and decrypt under the vault password.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { IMPORT_MNEMONIC, importWalletFromPhrase, VAULT_PASSPHRASE } from "./wallet-helpers";

// The published BIP-39 vector for 32 bytes of 0x7f: a valid 24-word phrase
// that holds nothing, never a wallet's.
const QSB_IMPORT_PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank year " +
  "wave sausage worth useful legal winner thank year wave sausage worth title";

const openQsbAccounts = async (sidepanel: Page): Promise<void> => {
  await sidepanel.locator("#account-trigger").click();
  await sidepanel.locator('.account-drawer [data-view="qsb-accounts"]').click();
  await expect(sidepanel.locator("#qsb-accounts-list")).not.toContainText("Loading QSB vaults");
};

const accountRow = (sidepanel: Page, id: string) =>
  sidepanel.locator(`#qsb-accounts-list [data-qsb-account="${id}"]`);

// Types the words the check asks for, read from their "Word N" labels.
const retypeCheckWords = async (sidepanel: Page, words: readonly string[]): Promise<void> => {
  const form = sidepanel.locator("#qsb-verify-form");
  const labels = await form.locator(".verify-grid label > span:first-child").allTextContents();
  expect(labels).toHaveLength(3);
  for (const [index, label] of labels.entries()) {
    const position = Number(label.replace(/\D+/g, ""));
    await form.locator(`input[name="qsb-verify-${index}"]`).fill(words[position - 1] ?? "");
  }
};

test("creates, backs up and imports QSB vaults", async ({ extension }) => {
  test.setTimeout(60_000);
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await importWalletFromPhrase(sidepanel, IMPORT_MNEMONIC);

  await openQsbAccounts(sidepanel);
  await expect(sidepanel.locator("#qsb-accounts-list")).toContainText("No QSB vaults yet.");

  // Create: the account exists before its phrase is shown, and the phrase is
  // shown only against the re-typed password.
  await sidepanel.locator("#qsb-create").click();
  const reveal = sidepanel.locator("#qsb-reveal-form");
  await expect(reveal).toBeVisible();
  await reveal.locator('input[name="vaultPassphrase"]').fill("not the wallet password");
  await reveal.getByRole("button", { name: "Show phrase" }).click();
  await expect(sidepanel.locator("#qsb-reveal-result")).toHaveText("That passphrase is wrong.");
  await expect(reveal.locator('input[name="vaultPassphrase"]')).toHaveValue("");
  await reveal.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
  await reveal.getByRole("button", { name: "Show phrase" }).click();

  const phraseInputs = sidepanel.locator(
    '#qsb-phrase-form input[data-recovery-kind="generated"]:not([hidden])',
  );
  await expect(phraseInputs.first()).not.toHaveValue("");
  const words = await phraseInputs.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );
  expect(words).toHaveLength(24);
  expect(words.every((word) => /^[a-z]+$/.test(word))).toBe(true);
  expect(words.join(" ")).not.toBe(IMPORT_MNEMONIC);

  await sidepanel.getByRole("button", { name: "Show QSB vault phrase", exact: true }).click();
  await sidepanel.getByRole("button", { name: "I saved my phrase" }).click();
  // The grid is emptied before the words are asked for.
  await expect(phraseInputs.first()).toHaveValue("");
  await retypeCheckWords(sidepanel, words);
  await sidepanel.getByRole("button", { name: "Confirm backup" }).click();
  await expect(sidepanel.locator('[data-qsb-step="done"]')).toContainText("Backup confirmed.");
  await sidepanel.locator("#qsb-backup-done").click();
  await expect(accountRow(sidepanel, "qsb-1")).toContainText("Ready");

  // Import: a phrase from elsewhere is accepted, but never as a writer.
  await sidepanel.locator('[data-view="qsb-import"]').click();
  const importForm = sidepanel.locator("#qsb-import-form");
  await importForm.locator('input[name="import-word-0"]').fill(QSB_IMPORT_PHRASE);
  await importForm.getByRole("button", { name: "Import phrase" }).click();
  await expect(sidepanel.locator("#qsb-import-done")).toHaveText("Imported as QSB vault 2.");
  await importForm.getByRole("button", { name: "Done" }).click();
  await expect(accountRow(sidepanel, "qsb-2")).toContainText("Read-only");

  // The same phrase twice is refused before anything is written.
  await sidepanel.locator('[data-view="qsb-import"]').click();
  await importForm.locator('input[name="import-word-0"]').fill(QSB_IMPORT_PHRASE);
  await importForm.getByRole("button", { name: "Import phrase" }).click();
  await expect(sidepanel.locator("#qsb-import-result")).toHaveText(
    "This phrase is already in this wallet.",
  );

  // Both accounts are read back from the vault and their own journals.
  await sidepanel.reload();
  await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible();
  await openQsbAccounts(sidepanel);
  await expect(accountRow(sidepanel, "qsb-1")).toContainText("Ready");
  await expect(accountRow(sidepanel, "qsb-2")).toContainText("Read-only");
  await expect(sidepanel.locator("#qsb-accounts-list")).not.toContainText("History unavailable");
});
