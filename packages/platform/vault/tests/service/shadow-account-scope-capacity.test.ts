/**
 * Shadow-account scope records against the vault's capacity (release audit S1).
 *
 * The count caps (128 scopes x 64 nonces) admitted about four times what the
 * vault's JSON budget holds when a dapp chooses full-width nonces, and the
 * pre-check tested only those caps. A record the budget refused was approved
 * first, and once the records filled the vault every other vault write failed
 * with no way to remove a record. The records now share at most half of the
 * budget, and the pre-check asks the vault's own capacity check too.
 */
import { describe, expect, test } from "bun:test";
import { isJson, isJsonWithinBudget, JSON_BUDGETS } from "@bramble/core/json";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { Vault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import {
  canonicalShadowAccountScope,
  MAX_SHADOW_ACCOUNT_NONCES,
  SHADOW_ACCOUNT_RECORD_LIMIT,
  SHADOW_ACCOUNT_SCOPES_BUDGET,
} from "@bramble/vault/shadow-account-scopes";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { VAULT_FULL } from "../../src/service/vault-capacity";
import { capacity, felt, vaultWith } from "./vault-fixture";

const vaultPassphrase = "correct horse battery staple";
const POOL = "0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const ANONYMIZER = "0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7";

// A service over a vault seeded with `vault`, as an earlier session left it.
const serviceOver = async (vault: Vault) => {
  const store = createMemoryStore();
  const vaultStore = createEncryptedStore(store, "bramble:vault");
  await vaultStore.write(vault, vaultPassphrase);
  const service = createWalletVaultService({
    encryptedStore: vaultStore,
    kms: fakeKms(),
    migrationStore: createEncryptedStore(store, "bramble:vault-migration"),
  });
  const account = vault.accounts[0];
  if (!account) throw new Error("fixture has no account");
  // The worst case a dapp can drive: a scope of the most full-width nonces.
  const fullScope = (site: number) => ({
    accountId: account.id,
    anonymizer: ANONYMIZER,
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    label: `Site ${site}`,
    nonces: Array.from({ length: MAX_SHADOW_ACCOUNT_NONCES }, (_, nonce) =>
      felt(site * 1_000 + nonce, 13n),
    ),
    origin: `https://site-${site}.example`,
    poolAddress: POOL,
    vaultPassphrase,
  });
  return { account, fullScope, service, vaultStore };
};

describe("the shadow-account record share", () => {
  test("is half the vault budget, derived from it", () => {
    expect(SHADOW_ACCOUNT_SCOPES_BUDGET).toEqual({
      ...JSON_BUDGETS.provider,
      maxBytes: JSON_BUDGETS.provider.maxBytes / 2,
    });
  });

  test("refuses full-width records before approval, and the vault keeps accepting writes", async () => {
    const { account, fullScope, service, vaultStore } = await serviceOver(vaultWith(10));
    let recorded = 0;
    while (await service.canRecordShadowAccountScope(fullScope(recorded))) {
      await service.recordShadowAccountScope(fullScope(recorded));
      recorded += 1;
      expect(recorded).toBeLessThan(128);
    }
    // The audit measured 34 full scopes filling this vault outright.
    expect(recorded).toBeGreaterThan(10);
    await expect(service.recordShadowAccountScope(fullScope(recorded))).rejects.toThrow(
      SHADOW_ACCOUNT_RECORD_LIMIT,
    );

    const vault = (await vaultStore.read(vaultPassphrase)) as Vault;
    expect(vault.shadowAccountScopes).toHaveLength(recorded);
    expect(isJsonWithinBudget(vault.shadowAccountScopes, SHADOW_ACCOUNT_SCOPES_BUDGET)).toBe(true);
    // Half the budget is still free for everything else: as many accounts
    // again as half the vault's capacity, beside the records.
    expect(
      isJson({
        ...vaultWith(Math.floor(capacity() / 2) - 1),
        shadowAccountScopes: vault.shadowAccountScopes,
      }),
    ).toBe(true);
    // Other vault writes still succeed.
    await service.grantOrigin({
      accountId: account.id,
      origin: "https://dapp.example",
      vaultPassphrase,
    });
    await service.setActiveAccount({ accountId: account.id, vaultPassphrase });
  });
});

describe("a vault filled by other content", () => {
  test("refuses the record before approval and leaves other writes working", async () => {
    const { account, fullScope, service, vaultStore } = await serviceOver(vaultWith(capacity()));
    const before = await vaultStore.read(vaultPassphrase);

    expect(await service.canRecordShadowAccountScope(fullScope(0))).toBe(false);
    await expect(service.recordShadowAccountScope(fullScope(0))).rejects.toThrow(VAULT_FULL);
    expect(await vaultStore.read(vaultPassphrase)).toEqual(before);

    await service.setActiveAccount({ accountId: account.id, vaultPassphrase });
  });

  test("still accepts a record that changes nothing", async () => {
    const full = vaultWith(capacity() - 1);
    const owner = full.accounts[0]?.id ?? "";
    const recorded = canonicalShadowAccountScope({
      accountId: owner,
      anonymizer: ANONYMIZER,
      chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
      label: "Site 0",
      nonces: ["0x1"],
      origin: "https://site-0.example",
      poolAddress: POOL,
    });
    if (!recorded) throw new Error("fixture scope is invalid");
    const { fullScope, service } = await serviceOver({ ...full, shadowAccountScopes: [recorded] });
    expect(await service.canRecordShadowAccountScope({ ...recorded, vaultPassphrase })).toBe(true);
    expect(await service.canRecordShadowAccountScope(fullScope(0))).toBe(false);
  });
});
