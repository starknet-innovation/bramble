/**
 * Imported-seed invariants: `importSeedAccounts` retains a foreign phrase as a
 * vault imported seed with each selected account bound to it, re-importing the
 * same phrase reuses its handle, the founding phrase never becomes an imported
 * seed, index allocation stays per-phrase, reveal returns the phrase that
 * backs the active account, and duplicates fail closed without a write.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import { activeAccountSecrets, createWalletVaultService } from "@bramble/vault/service";

const foundingMnemonic =
  "habit hope tip crystal because grunt nation idea electric witness alert like";
const importedMnemonic =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const otherMnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
const vaultPassphrase = "correct horse battery staple";

// Distinct keys per (phrase, accountIndex) so imported-seed accounts derive
// real distinct addresses and cross-phrase index collisions are observable.
const phraseKms = (): KmsPort => ({
  ...fakeKms(),
  async deriveStarknetKeypair(mnemonic: string, _addressIndex: number, accountIndex: number) {
    const tag = mnemonic === foundingMnemonic ? "f" : mnemonic === importedMnemonic ? "a" : "b";
    const felt = `0x${tag === "f" ? "1" : tag === "a" ? "2" : "3"}${accountIndex + 1}`;
    return { privateKey: felt, publicKeyX: `${felt}ab`, publicKeyY: `${felt}cd` };
  },
});

const newService = () => {
  const store = createMemoryStore();
  return createWalletVaultService({
    encryptedStore: createEncryptedStore(store, "bramble:vault"),
    kms: phraseKms(),
    migrationStore: createEncryptedStore(store, "bramble:vault-migration"),
  });
};

const seeded = async () => {
  const service = newService();
  await service.createAccount({
    accountContractType: "openzeppelin",
    mnemonic: foundingMnemonic,
    networkId: "SN_MAIN",
    vaultPassphrase,
  });
  return service;
};

const selection = (accountIndex: number) =>
  ({ accountContractType: "openzeppelin", accountIndex }) as const;

describe("importSeedAccounts", () => {
  test("retains the phrase as an imported seed and binds each account to it", async () => {
    const service = await seeded();
    const accounts = await service.importSeedAccounts({
      mnemonic: importedMnemonic,
      networkId: "SN_MAIN",
      selections: [selection(0), selection(2)],
      vaultPassphrase,
    });
    expect(accounts.map((account) => account.derivation)).toEqual([
      { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44", seedId: "phrase-1" },
      { accountIndex: 2, addressIndex: 0, kind: "starknet-bip44", seedId: "phrase-1" },
    ]);

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.importedSeeds).toEqual([{ id: "phrase-1", mnemonic: importedMnemonic }]);
    // Every imported account holds its signing key like any software account.
    for (const account of accounts) {
      expect(vault.signingKeys.some((key) => key.accountId === account.id)).toBe(true);
    }
    expect(vault.mnemonic).toBe(foundingMnemonic);
  });

  test("re-importing the same phrase reuses its handle for further indices", async () => {
    const service = await seeded();
    await service.importSeedAccounts({
      mnemonic: importedMnemonic,
      networkId: "SN_MAIN",
      selections: [selection(0)],
      vaultPassphrase,
    });
    const more = await service.importSeedAccounts({
      mnemonic: importedMnemonic,
      networkId: "SN_MAIN",
      selections: [selection(1)],
      vaultPassphrase,
    });
    expect(more[0]?.derivation).toMatchObject({ seedId: "phrase-1" });

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.importedSeeds).toEqual([{ id: "phrase-1", mnemonic: importedMnemonic }]);
  });

  test("a second distinct phrase gets the next deterministic handle", async () => {
    const service = await seeded();
    await service.importSeedAccounts({
      mnemonic: importedMnemonic,
      networkId: "SN_MAIN",
      selections: [selection(0)],
      vaultPassphrase,
    });
    const accounts = await service.importSeedAccounts({
      mnemonic: otherMnemonic,
      networkId: "SN_MAIN",
      selections: [selection(0)],
      vaultPassphrase,
    });
    expect(accounts[0]?.derivation).toMatchObject({ seedId: "phrase-2" });
  });

  test("the founding phrase derives without a handle and is never re-retained", async () => {
    const service = await seeded();
    const accounts = await service.importSeedAccounts({
      mnemonic: foundingMnemonic,
      networkId: "SN_MAIN",
      selections: [selection(3)],
      vaultPassphrase,
    });
    expect(accounts[0]?.derivation).toEqual({
      accountIndex: 3,
      addressIndex: 0,
      kind: "starknet-bip44",
    });
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.importedSeeds).toEqual([]);
  });

  test("an account already in the vault fails closed without writing", async () => {
    const service = await seeded();
    await service.importSeedAccounts({
      mnemonic: importedMnemonic,
      networkId: "SN_MAIN",
      selections: [selection(0)],
      vaultPassphrase,
    });
    await expect(
      service.importSeedAccounts({
        mnemonic: importedMnemonic,
        networkId: "SN_MAIN",
        selections: [selection(0)],
        vaultPassphrase,
      }),
    ).rejects.toThrow("Account already exists");
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts.length).toBe(2);
  });

  test("index allocation for new founding-phrase accounts ignores imported seeds", async () => {
    const service = await seeded(); // founding account occupies index 0
    await service.importSeedAccounts({
      mnemonic: importedMnemonic,
      networkId: "SN_MAIN",
      // The imported seed occupies indices 1 and 2 in ITS OWN space.
      selections: [selection(1), selection(2)],
      vaultPassphrase,
    });
    const next = await service.addDerivedAccount({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    // The founding phrase's next free index is 1, not 3.
    expect(next.derivation).toEqual({ accountIndex: 1, addressIndex: 0, kind: "starknet-bip44" });
  });

  test("reveal returns the phrase backing the active account", async () => {
    const service = await seeded();
    const [imported] = await service.importSeedAccounts({
      mnemonic: importedMnemonic,
      networkId: "SN_MAIN",
      selections: [selection(0)],
      vaultPassphrase,
    });
    // importSeedAccounts selects the first imported account as active, and
    // reveal follows the account to ITS phrase — the one that recovers it.
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.activeAccountId).toBe(imported?.id ?? "");
    expect(activeAccountSecrets(vault).mnemonic).toBe(importedMnemonic);

    // Switching back to a founding-phrase account reveals the founding phrase.
    const founding = vault.accounts.find(
      (account) =>
        account.derivation.kind === "starknet-bip44" && account.derivation.seedId === undefined,
    );
    expect(activeAccountSecrets({ ...vault, activeAccountId: founding?.id ?? null }).mnemonic).toBe(
      foundingMnemonic,
    );
  });

  test("rejects an invalid phrase and malformed selections", async () => {
    const service = await seeded();
    await expect(
      service.importSeedAccounts({
        mnemonic: importedMnemonic,
        networkId: "SN_MAIN",
        selections: [],
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid recovery account selection");
    await expect(
      service.importSeedAccounts({
        mnemonic: importedMnemonic,
        networkId: "SN_MAIN",
        selections: [selection(0), selection(0)],
        vaultPassphrase,
      }),
    ).rejects.toThrow("Duplicate recovery account selection");
  });
});
