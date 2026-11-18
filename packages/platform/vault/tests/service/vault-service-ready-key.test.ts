/**
 * `hasPreFixReadyKey` answers from a per-unlock cache: the first check
 * decrypts the vault and derives the public key, later checks for the same
 * account do neither, a failed check is not cached, and the lock drops it.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { deriveAccount } from "@bramble/vault/accounts";
import { createEncryptedStore, type EncryptedStore } from "@bramble/vault/encrypted-store";
import type { Vault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";
// A real Ready record, derived the way a restore stores it; the fake KMS's
// keypair gives it the stored key the tests compare against.
const ready = await deriveAccount(fakeKms(), {
  accountContractType: "argent",
  accountIndex: 0,
  derivation: "argentx-bip44",
  mnemonic,
  networkId: "SN_MAIN",
});
const READY_ID = ready.account.id;
const READY_KEY = (ready.account as { readonly publicKeyX: string }).publicKeyX;

const readyVault = (vault: Vault): Vault =>
  ({
    ...vault,
    accounts: [...vault.accounts, ready.account],
    signingKeys: [...vault.signingKeys, { accountId: READY_ID, privateKey: ready.privateKey }],
  }) as unknown as Vault;

const setup = async (derive: () => Promise<string>) => {
  let reads = 0;
  let derivations = 0;
  const inner = createEncryptedStore(createMemoryStore(), "bramble:vault");
  const store: EncryptedStore = {
    ...inner,
    read: async (password: string) => {
      reads += 1;
      const vault = await inner.read(password);
      const stored = vault as Partial<Vault> | null | undefined;
      return Array.isArray(stored?.accounts) && stored.accounts.length > 0
        ? readyVault(stored as Vault)
        : vault;
    },
  };
  const service = createWalletVaultService({
    encryptedStore: store,
    kms: {
      ...fakeKms(),
      async deriveArgentLegacyPublicKey() {
        derivations += 1;
        return derive();
      },
    },
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
  });
  await service.createAccount({
    accountContractType: "openzeppelin",
    mnemonic,
    networkId: "SN_MAIN",
    vaultPassphrase,
  });
  reads = 0;
  return {
    check: () => service.hasPreFixReadyKey({ accountId: READY_ID, vaultPassphrase }),
    counts: () => ({ derivations, reads }),
    lock: () => service.clearGrantCache(),
  };
};

describe("hasPreFixReadyKey cache", () => {
  test("derives once per unlock and again after the lock", async () => {
    const { check, counts, lock } = await setup(async () => `0x${"c".repeat(63)}`);
    expect(await check()).toBe(true);
    const first = counts();
    expect(first.derivations).toBe(1);
    expect(await check()).toBe(true);
    expect(counts()).toEqual(first);
    lock();
    expect(await check()).toBe(true);
    expect(counts().derivations).toBe(2);
    expect(counts().reads).toBeGreaterThan(first.reads);
  });

  test("does not cache a failed check", async () => {
    let fail = true;
    const { check, counts } = await setup(async () => {
      if (fail) throw new Error("krusty unavailable");
      return READY_KEY;
    });
    await expect(check()).rejects.toThrow("krusty unavailable");
    fail = false;
    expect(await check()).toBe(false);
    expect(counts().derivations).toBe(2);
  });
});
