/**
 * Import by address for a private key in the built extension (issue 779):
 * first run, against a mocked chain where no Argent release derives an account
 * for the key, but an Argent 0.4.0 account at a pasted address is owned by the
 * key's public key, answered alike by the gateway and the Foundation node.
 * Discovery finds nothing, the finder is offered, a pasted explorer link finds
 * the account, and the wallet is created holding it at the pasted address
 * (the background proves the owner again before writing).
 */
import type { Page, Route } from "@playwright/test";
import { ec, hash } from "starknet";
import { expect, test } from "./fixtures";
import { sendRuntimeMessage } from "./wallet-helpers";

// Clearly-fake test vector; not a real key and holds nothing on any network.
const READY_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const PASSPHRASE = "ready key e2e passphrase";
const ARGENT_0_4_0 = "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";
const PASTED = "0x7e57ad0e55";
const OWNER = ec.starkCurve.getStarkKey(READY_KEY);

type RpcCall = {
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
};

const sameFelt = (left: unknown, right: string): boolean =>
  typeof left === "string" && BigInt(left) === BigInt(right);

// One Argent 0.4.0 account at PASTED owned by the key, nothing anywhere else,
// zero balances everywhere.
const chainAnswer = (call: RpcCall) => {
  const id = call.id ?? null;
  const ok = (result: unknown) => ({ id, jsonrpc: "2.0", result });
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
    if (sameFelt(selector, hash.getSelectorFromName("get_owner"))) return ok([OWNER]);
    if (sameFelt(selector, hash.getSelectorFromName("get_owner_type"))) return ok(["0x0"]);
    if (sameFelt(selector, hash.getSelectorFromName("get_guardian"))) return ok(["0x0"]);
    return ok(["0x0", "0x0"]);
  }
  return { error: { code: -32601, message: "Method not found" }, id, jsonrpc: "2.0" };
};

const mockChain = async (page: Page): Promise<void> => {
  await page.context().route("https://*.starknet.org/**", async (route: Route) => {
    const body = route.request().postDataJSON() as RpcCall | RpcCall[];
    await route.fulfill({
      json: Array.isArray(body) ? body.map(chainAnswer) : chainAnswer(body),
    });
  });
};

test("a Ready key's account is found by its address and imported there", async ({ extension }) => {
  const onboarding = await extension.openExtensionPage("onboarding.html");
  await mockChain(onboarding);
  await onboarding.locator("#add-existing-button").click();
  await onboarding.locator("#key-method-button").click();
  await onboarding.locator('select[name="importKeyContractType"]').selectOption("argent");
  await onboarding.locator('textarea[name="importKeyRaw"]').fill(READY_KEY);
  await onboarding.locator("#import-key-continue").click();
  await expect(onboarding.locator("#import-key-result")).toHaveText(
    "Couldn't find a Ready account for this key on this network.",
  );

  const finder = onboarding.locator('[data-recovery-address="key"]');
  await finder.getByText("Can't find it? Paste the account address").click();
  await expect(finder.locator("[data-recovery-address-network]")).toHaveText("On Starknet Mainnet");
  await onboarding
    .locator('input[name="keyAddress"]')
    .fill(`https://voyager.online/contract/${PASTED}`);
  await onboarding.locator("#key-address-search").click();
  await expect(onboarding.locator("#key-address-result")).toHaveText("Found your account.");
  const picker = onboarding.locator("[data-ready-key-picker]");
  await expect(picker.locator("input.select-check:checked")).toHaveCount(1);

  await onboarding.locator("#import-key-continue").click();
  await onboarding.locator('input[name="vaultPassphrase"]').fill(PASSPHRASE);
  await onboarding.locator('input[name="vaultPassphraseConfirm"]').fill(PASSPHRASE);
  await onboarding.locator("#password-continue-button").click();

  await expect.poll(() => onboarding.isClosed(), { timeout: 15_000 }).toBe(true);
  const sidepanel = await extension.openExtensionPage("sidepanel.html");
  await expect
    .poll(async () => {
      const status = await sendRuntimeMessage<{
        readonly accounts?: readonly { readonly address: string }[];
      }>(sidepanel, { type: "wallet.status" });
      return status?.accounts?.map(({ address }) => BigInt(address).toString(16));
    })
    .toEqual([BigInt(PASTED).toString(16)]);
  expect(await sidepanel.content()).not.toContain(READY_KEY.slice(2));
});
