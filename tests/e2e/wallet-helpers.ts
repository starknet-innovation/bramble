/**
 * Shared side-panel helpers for extension E2E tests.
 */

import { BACKUP_VERIFY_POSITIONS } from "@bramble/wallet-ui/lab";
import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

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
      // Completion hands itself off: it opens the side panel and closes its
      // own tab. Headless Chromium resolves that open too, so the tab may
      // already be gone by the time we look; accept either state.
      await expect
        .poll(
          async () =>
            onboarding.isClosed() ||
            (await onboarding
              .getByRole("heading", { name: "You’re all set" })
              .isVisible()
              .catch(() => false)),
          { timeout: 15_000 },
        )
        .toBe(true);
      if (!onboarding.isClosed()) {
        await onboarding.close();
      }
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
const fillBackupVerify = async (sidepanel: Page, phrase: string): Promise<void> => {
  const words = phraseWords(phrase);
  await expect(sidepanel.getByRole("heading", { name: "Confirm your backup" })).toBeVisible();
  for (const [index, position] of BACKUP_VERIFY_POSITIONS.entries()) {
    await sidepanel.locator(`input[name="verify-${index}"]`).fill(words[position - 1] ?? "");
  }
  await expect(sidepanel.locator("#verify-result")).toHaveText("Backup confirmed.");
};

const protectAndSelectAccount = async (
  sidepanel: Page,
  passphrase: string = VAULT_PASSPHRASE,
): Promise<void> => {
  await sidepanel.locator('input[name="vaultPassphrase"]').fill(passphrase);
  await sidepanel.locator('input[name="vaultPassphraseConfirm"]').fill(passphrase);
  await sidepanel.getByRole("button", { name: "Review account" }).click();
  await expect(sidepanel.getByRole("heading", { name: "Review your account" })).toBeVisible();
  await sidepanel.locator("#account-preview").click();
  await acknowledgeMainnetIfPresent(sidepanel);
  await expect(sidepanel.getByRole("button", { name: "Add selected account" })).toBeEnabled();
  await sidepanel.getByRole("button", { name: "Add selected account" }).click();
};

const mockEmptyRecoveryChain = async (page: Page): Promise<() => Promise<void>> => {
  const pattern = "https://*.starknet.org/**";
  const handler = async (route: Route): Promise<void> => {
    const request = route.request().postDataJSON() as {
      readonly id?: unknown;
      readonly method?: unknown;
    };
    const id = request.id ?? 1;
    if (request.method === "starknet_getClassHashAt") {
      await route.fulfill({
        json: { error: { code: 20, message: "Contract not found" }, id, jsonrpc: "2.0" },
      });
      return;
    }
    if (request.method === "starknet_call") {
      await route.fulfill({ json: { id, jsonrpc: "2.0", result: ["0x0", "0x0"] } });
      return;
    }
    await route.abort();
  };
  await page.context().route(pattern, handler);
  return () => page.context().unroute(pattern, handler);
};

const protectAndRecoverAccounts = async (onboarding: Page, passphrase: string): Promise<void> => {
  await onboarding.locator('input[name="vaultPassphrase"]').fill(passphrase);
  await onboarding.locator('input[name="vaultPassphraseConfirm"]').fill(passphrase);
  await onboarding.getByRole("button", { name: "Find my accounts" }).click();
  await expect(onboarding.getByRole("heading", { name: "Find your accounts" })).toBeVisible();
  await expect(onboarding.locator("#recovery-scan-status")).toContainText("Search complete");
  // The mocked chain reports no activity, so the Bramble group starts closed
  // with nothing auto-selected: open it and pick the first index by hand.
  const brambleGroup = onboarding.locator('[data-recovery-group="openzeppelin"]');
  await brambleGroup.locator("summary").click();
  await brambleGroup.locator('input[type="checkbox"]').first().check();
  await onboarding.locator('input[name="recoveryMainnetAck"]').check();
  await onboarding.getByRole("button", { name: "Restore selected accounts" }).click();
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
 *
 * `passphrase` protects the new vault and must match what a later unlock uses.
 */
export const importWalletFromPhrase = async (
  sidepanel: Page,
  mnemonic: string,
  passphrase: string = VAULT_PASSPHRASE,
): Promise<void> => {
  const setup = await fullScreenSetup(sidepanel);
  const onboarding = setup.page;
  await expect(onboarding.getByRole("button", { name: "Add an existing wallet" })).toBeVisible();
  await onboarding.getByRole("button", { name: "Add an existing wallet" }).click();
  await onboarding.getByRole("button", { name: "Recovery phrase" }).click();
  await onboarding.locator('input[name="import-word-0"]').fill(mnemonic);
  await onboarding.getByRole("button", { name: "Continue" }).click();
  const stopMock = await mockEmptyRecoveryChain(onboarding);
  try {
    await protectAndRecoverAccounts(onboarding, passphrase);
  } finally {
    await stopMock();
  }
  await setup.finish();
  if (!new URL(sidepanel.url()).pathname.endsWith("/onboarding.html")) {
    await expect(sidepanel.getByRole("button", { name: "Lock wallet" })).toBeVisible();
  }
};

/**
 * Sends one background message from a wallet page and returns its response.
 *
 * The single place this suite reaches the privileged background from a page:
 * `chrome` is untyped inside `evaluate`, so keeping one narrow shape here stops
 * that cast from being rewritten at each call site. Rejects if the page is gone
 * or the background never answers — callers decide what that means.
 */
export const sendRuntimeMessage = async <T>(page: Page, message: unknown): Promise<T | undefined> =>
  page.evaluate(async (payload) => {
    const extensionGlobal = globalThis as typeof globalThis & {
      readonly chrome?: {
        readonly runtime?: {
          readonly sendMessage?: (message: unknown) => Promise<unknown>;
        };
      };
    };
    return (await extensionGlobal.chrome?.runtime?.sendMessage?.(payload)) as T | undefined;
  }, message);

/**
 * Submits the passphrase on the "Welcome back" gate screen.
 *
 * Returns once the click lands, not once the vault has opened: the caller must
 * wait on whatever it expects next. A wrong passphrase leaves the gate in place
 * with the reason in `#form-result`, so nothing here throws on rejection.
 */
export const unlockWallet = async (
  sidepanel: Page,
  passphrase: string = VAULT_PASSPHRASE,
): Promise<void> => {
  await sidepanel.locator('input[name="vaultPassphrase"]').fill(passphrase);
  await sidepanel.getByRole("button", { name: "Unlock" }).click();
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
  await expect(sidepanel.getByText(eyebrow, { exact: true }).first()).toBeVisible();
  // The compact card shows the host while preserving the exact origin as its title.
  await expect(sidepanel.getByTitle(origin).first()).toBeVisible();
  await sidepanel.locator(`[data-approval-action="${action}"]`).click();
};
