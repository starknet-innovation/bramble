/**
 * Import by address in the built extension (issue 398): first-run restore,
 * against a mocked chain that reports an Argent account at a pasted address
 * whose owner is this phrase's own-ladder key, answered alike by the gateway
 * and the Foundation node. The account is found, picked, and restored (the
 * background proves the owner again before writing), and an
 * address with nothing deployed is answered with the network it searched.
 */
import type { Page, Route } from "@playwright/test";
import { hash } from "starknet";
import { expect, test } from "./fixtures";
import { IMPORT_MNEMONIC, VAULT_PASSPHRASE } from "./wallet-helpers";

const ARGENT_0_4_0 = "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";
const PASTED = "0x7e57ad0e55";

type RpcCall = {
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
};

const sameFelt = (left: unknown, right: string): boolean =>
  typeof left === "string" && BigInt(left) === BigInt(right);

// The chain the import sees: one Argent 0.4.0 account at PASTED owned by
// `owner`, nothing deployed anywhere else, and zero balances.
const chainAnswer = (call: RpcCall, owner: string) => {
  const id = call.id ?? null;
  const ok = (result: unknown) => ({ id, jsonrpc: "2.0", result });
  // Both sources (the gateway and the Foundation node) prove the chain first.
  if (call.method === "starknet_chainId") return ok("0x534e5f4d41494e");
  if (call.method === "starknet_blockHashAndNumber") {
    return ok({ block_hash: "0x1b10c", block_number: 1 });
  }
  if (call.method === "starknet_getClassHashAt") {
    return sameFelt(call.params?.["contract_address"], PASTED)
      ? ok(ARGENT_0_4_0)
      : { error: { code: 20, message: "Contract not found" }, id, jsonrpc: "2.0" };
  }
  if (call.method === "starknet_call") {
    const request = call.params?.["request"] as Record<string, unknown> | undefined;
    const selector = request?.["entry_point_selector"];
    if (sameFelt(selector, hash.getSelectorFromName("get_owner"))) return ok([owner]);
    if (sameFelt(selector, hash.getSelectorFromName("get_owner_type"))) return ok(["0x0"]);
    if (sameFelt(selector, hash.getSelectorFromName("get_guardian"))) return ok(["0x0"]);
    return ok(["0x0", "0x0"]);
  }
  return { error: { code: -32601, message: "Method not found" }, id, jsonrpc: "2.0" };
};

const mockChain = async (page: Page, owner: string): Promise<void> => {
  await page.context().route("https://*.starknet.org/**", async (route: Route) => {
    const body = route.request().postDataJSON() as RpcCall | RpcCall[];
    await route.fulfill({
      json: Array.isArray(body)
        ? body.map((call) => chainAnswer(call, owner))
        : chainAnswer(body, owner),
    });
  });
};

// The phrase's Argent key at index 0 on this wallet's own ladder, read through
// the extension's own public preview: the first key the lookup tries.
const ownLadderKey = (page: Page): Promise<string> =>
  page.evaluate(async (mnemonic) => {
    const extension = globalThis as typeof globalThis & {
      readonly chrome: {
        readonly runtime: { readonly sendMessage: (message: unknown) => Promise<unknown> };
      };
    };
    const response = (await extension.chrome.runtime.sendMessage({
      accountContractType: "argent",
      accountIndex: 0,
      mnemonic,
      networkId: "SN_MAIN",
      type: "wallet.previewAccount",
    })) as { readonly account: { readonly publicKeyX: string } };
    return response.account.publicKeyX;
  }, IMPORT_MNEMONIC);

const reachPicker = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Add an existing wallet" }).click();
  await page.getByRole("button", { name: "Recovery phrase" }).click();
  await page.locator('input[name="import-word-0"]').fill(IMPORT_MNEMONIC);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[name="vaultPassphrase"]').fill(VAULT_PASSPHRASE);
  await page.locator('input[name="vaultPassphraseConfirm"]').fill(VAULT_PASSPHRASE);
  await page.getByRole("button", { name: "Find my accounts" }).click();
  await expect(page.locator("#recovery-scan-status")).toContainText("Search complete");
  await page.getByText("Can't find it? Paste the account address").click();
};

test("finds a Ready account by its address and restores it", async ({ extension }) => {
  const page = await extension.openExtensionPage("onboarding.html");
  await mockChain(page, await ownLadderKey(page));
  await reachPicker(page);
  await expect(page.locator("[data-recovery-address-network]")).toHaveText("On Starknet Mainnet");
  await page
    .locator('input[name="recoveryAddress"]')
    .fill(`https://starkscan.co/contract/${PASTED}`);
  await page.getByRole("button", { name: "Find account" }).click();
  await expect(page.locator("#recovery-address-result")).toHaveText("Found Account 0.");
  const ready = page.locator('[data-recovery-group="argent"]');
  await expect(ready.locator("code[title]").filter({ hasText: /7e57/ })).toHaveCount(1);
  await expect(ready.locator("input.select-check:checked")).toHaveCount(1);
  await page.getByRole("button", { name: "Restore selected accounts" }).click();
  await expect
    .poll(
      async () =>
        page.isClosed() ||
        (await page
          .getByRole("heading", { name: "You’re all set" })
          .isVisible()
          .catch(() => false)),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("says when nothing is deployed at the address on this network", async ({ extension }) => {
  const page = await extension.openExtensionPage("onboarding.html");
  await mockChain(page, "0x1");
  await reachPicker(page);
  await page.locator('input[name="recoveryAddress"]').fill("0xabc");
  await page.getByRole("button", { name: "Find account" }).click();
  await expect(page.locator("#recovery-address-result")).toHaveText(
    "No account found at this address on Starknet Mainnet. Check the address and network.",
  );
});
