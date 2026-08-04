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

const fullScreenSetup = async (
  walletSurface: Page,
): Promise<{ readonly finish: () => Promise<void>; readonly page: Page }> => {
  if (new URL(walletSurface.url()).pathname.endsWith("/onboarding.html")) {
    return { finish: async () => undefined, page: walletSurface };
  }
  const onboarding = await walletSurface.context().newPage();
  await onboarding.goto(new URL("onboarding.html", walletSurface.url()).toString());
  return {
    finish: async () => {
      await expect(onboarding.getByRole("heading", { name: "You’re all set" })).toBeVisible();
      await onboarding.close();
      await walletSurface.reload();
    },
    page: onboarding,
  };
};

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
  await expect(sidepanel.getByRole("heading", { name: "Confirm your backup" })).toBeVisible();
  for (const [index, position] of BACKUP_VERIFY_POSITIONS.entries()) {
    await sidepanel.locator(`input[name="verify-${index}"]`).fill(words[position - 1] ?? "");
  }
  await expect(sidepanel.locator("#verify-result")).toHaveText("Backup confirmed.");
};

const protectAndSelectAccount = async (sidepanel: Page): Promise<void> => {
  await sidepanel.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
  await sidepanel.locator('input[name="vaultPassphraseConfirm"]').fill(VAULT_PASSPHRASE);
  await sidepanel.getByRole("button", { name: "Review account" }).click();
  await expect(sidepanel.getByRole("heading", { name: "Choose accounts to add" })).toBeVisible();
  await sidepanel.locator("#account-preview").click();
  await acknowledgeMainnetIfPresent(sidepanel);
  await expect(sidepanel.getByRole("button", { name: "Add selected account" })).toBeEnabled();
  await sidepanel.getByRole("button", { name: "Add selected account" }).click();
};

/**
 * Creates a wallet by generating a fresh recovery phrase and confirming backup words.
 */
export const createWalletFromGeneratedPhrase = async (sidepanel: Page): Promise<void> => {
  const setup = await fullScreenSetup(sidepanel);
  const onboarding = setup.page;
  await expect(onboarding.getByRole("button", { name: "Create a new wallet" })).toBeVisible();
  await onboarding.getByRole("button", { name: "Create a new wallet" }).click();
  await expect(
    onboarding.getByRole("heading", { name: "Save your recovery phrase" }),
  ).toBeVisible();
  const phraseInputs = onboarding.locator('input[data-recovery-kind="generated"]:not([hidden])');
  await expect(phraseInputs.first()).not.toHaveValue("");
  const phrase = await phraseInputs.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value).join(" "),
  );
  await onboarding.getByRole("button", { name: "Show recovery phrase" }).click();
  await onboarding.getByRole("button", { name: "I saved my phrase" }).click();
  await fillBackupVerify(onboarding, phrase);
  await onboarding.getByRole("button", { name: "Continue" }).click();
  await protectAndSelectAccount(onboarding);
  await setup.finish();
  await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible();
};

/**
 * Creates a wallet by pasting an existing recovery phrase (skips backup verification).
 */
export const importWalletFromPhrase = async (sidepanel: Page, mnemonic: string): Promise<void> => {
  const setup = await fullScreenSetup(sidepanel);
  const onboarding = setup.page;
  await expect(onboarding.getByRole("button", { name: "Add an existing wallet" })).toBeVisible();
  await onboarding.getByRole("button", { name: "Add an existing wallet" }).click();
  await onboarding.getByRole("button", { name: "Recovery phrase" }).click();
  await onboarding.locator('input[name="import-word-0"]').fill(mnemonic);
  await onboarding.getByRole("button", { name: "Continue" }).click();
  await protectAndSelectAccount(onboarding);
  await setup.finish();
  if (!new URL(sidepanel.url()).pathname.endsWith("/onboarding.html")) {
    await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible();
  }
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
 * Models Chrome opening a fresh native wallet surface in headless Chromium,
 * which does not expose its side-panel container to Playwright.
 */
export const openPendingWalletSurface = async (
  sidepanel: Page,
  timeout = 10_000,
  abort?: () => Error | null,
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const abortError = abort?.();
        if (abortError) {
          throw abortError;
        }
        return sidepanel.evaluate(async () => {
          const extensionGlobal = globalThis as typeof globalThis & {
            readonly chrome?: {
              readonly runtime?: {
                readonly sendMessage?: (message: unknown) => Promise<unknown>;
              };
            };
          };
          const response = (await extensionGlobal.chrome?.runtime?.sendMessage?.({
            type: "wallet.pendingApprovals",
          })) as { readonly pending?: readonly unknown[] } | undefined;
          return response?.pending?.length ?? 0;
        });
      },
      { timeout },
    )
    .toBeGreaterThan(0);
  await sidepanel.reload();
};

/**
 * Handles a pending connection approval on the takeover screen.
 */
export const resolveConnectionApproval = async (
  sidepanel: Page,
  origin: string,
  action: "approve" | "deny",
): Promise<void> => {
  await resolvePendingApproval(sidepanel, "Connection request", origin, action);
};

/**
 * Resolves a pending approval identified by its card eyebrow (for example
 * "Connection request", "Sign request", or "Transaction request"). A pending
 * request proactively takes over the panel's dock views — no navigation is
 * needed; the decision controls are already on screen.
 */
export const resolvePendingApproval = async (
  sidepanel: Page,
  eyebrow: string,
  origin: string,
  action: "approve" | "deny",
  timeout?: number,
  abort?: () => Error | null,
): Promise<void> => {
  await openPendingWalletSurface(sidepanel, timeout, abort);
  await expect(sidepanel.getByText("Review request")).toBeVisible();
  await expect(sidepanel.getByText(eyebrow)).toBeVisible();
  // The origin renders in both the takeover header and the request card.
  await expect(sidepanel.getByText(origin).first()).toBeVisible();
  await sidepanel.locator(`[data-approval-action="${action}"]`).click();
};
