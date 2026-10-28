/**
 * First-run Ready private-key import through the built extension (issue 776).
 * A Ready key lists the Argent releases it controls an address in use at, the
 * user picks, and the wallet is created holding exactly the picked accounts. A
 * key with nothing on chain is refused with the honest message and no picker.
 * The chain is mocked at the network layer; the key is clearly fake.
 */
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sendRuntimeMessage } from "./wallet-helpers";

// Clearly-fake test vector; not a real key and holds nothing on any network.
const READY_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const PASSPHRASE = "ready key e2e passphrase";
// Argent 0.4.0: what the mocked chain says every address runs.
const ARGENT_040 = "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";

type Call = { readonly id?: string | number | null; readonly method?: unknown };

// `deployed` true: every address runs Argent 0.4.0; false: nothing is
// deployed and every balance is zero. Any other method gets a JSON-RPC error.
const mockChain = async (page: Page, deployed: boolean): Promise<void> => {
  const answer = (call: Call) => {
    const id = call.id ?? null;
    if (call.method === "starknet_getClassHashAt") {
      return deployed
        ? { id, jsonrpc: "2.0", result: ARGENT_040 }
        : { error: { code: 20, message: "Contract not found" }, id, jsonrpc: "2.0" };
    }
    if (call.method === "starknet_call") return { id, jsonrpc: "2.0", result: ["0x0", "0x0"] };
    return { error: { code: -32601, message: "Method not found" }, id, jsonrpc: "2.0" };
  };
  await page.context().route("https://*.starknet.org/**", async (route: Route) => {
    const body: unknown = route.request().postDataJSON();
    await route.fulfill({
      json: Array.isArray(body) ? body.map((call: Call) => answer(call)) : answer(body as Call),
    });
  });
};

const startReadyKeyImport = async (onboarding: Page): Promise<void> => {
  await onboarding.locator("#add-existing-button").click();
  await onboarding.locator("#key-method-button").click();
  await onboarding.locator('select[name="importKeyContractType"]').selectOption("argent");
  await onboarding.locator('textarea[name="importKeyRaw"]').fill(READY_KEY);
  await onboarding.locator("#import-key-continue").click();
};

test("a Ready key lists its accounts and imports the picked ones", async ({ extension }) => {
  const onboarding = await extension.openExtensionPage("onboarding.html");
  await mockChain(onboarding, true);
  await startReadyKeyImport(onboarding);

  const picker = onboarding.locator("[data-ready-key-picker]");
  await expect(picker).toBeVisible();
  const rows = picker.locator("[data-ready-key-class]");
  await expect(rows).toHaveCount(4);
  // Every row is deployed here, so every row starts ticked; untick one.
  await rows.nth(1).uncheck();
  await onboarding.locator("#import-key-continue").click();

  await onboarding.locator('input[name="vaultPassphrase"]').fill(PASSPHRASE);
  await onboarding.locator('input[name="vaultPassphraseConfirm"]').fill(PASSPHRASE);
  await onboarding.locator("#password-continue-button").click();

  // Completion hands off to the side panel and closes the setup tab.
  await expect.poll(() => onboarding.isClosed(), { timeout: 10_000 }).toBe(true);
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await expect
    .poll(async () => {
      const status = await sendRuntimeMessage<{ readonly accountCount?: number }>(sidepanel, {
        type: "wallet.status",
      });
      return status?.accountCount;
    })
    .toBe(3);
  expect(await sidepanel.content()).not.toContain(READY_KEY.slice(2));
});

test("a Ready key with nothing on chain is refused, with no picker", async ({ extension }) => {
  const onboarding = await extension.openExtensionPage("onboarding.html");
  await mockChain(onboarding, false);
  await startReadyKeyImport(onboarding);

  await expect(onboarding.locator("#import-key-result")).toHaveText(
    "Couldn't find a Ready account for this key on this network.",
  );
  await expect(onboarding.locator("[data-ready-key-picker]")).toHaveCount(0);
  await expect(onboarding.locator('[data-onboarding-step="import-key"]')).toBeVisible();
});
