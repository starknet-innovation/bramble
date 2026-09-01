/** Atomic multi-account recovery checks for the encrypted vault boundary. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import { createWalletVaultService } from "@bramble/vault/service";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";
const indexedKms = (): KmsPort => ({
  ...fakeKms(),
  async deriveStarknetKeypair(_mnemonic, _addressIndex, accountIndex) {
    return {
      privateKey: `0x1234${accountIndex + 1}`,
      publicKeyX: `0xabc${accountIndex}`,
      publicKeyY: "0xdef",
    };
  },
});

describe("vault recovery", () => {
  test("restores selected OZ and Argent coordinates in one encrypted vault", async () => {
    const store = createMemoryStore();
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(store, "mc-wallet:vault"),
      kms: indexedKms(),
      migrationStore: createEncryptedStore(store, "mc-wallet:vault-migration"),
    });
    const accounts = await service.recoverAccounts({
      mnemonic,
      networkId: "SN_MAIN",
      selections: [
        { accountContractType: "openzeppelin", accountIndex: 2 },
        { accountContractType: "argent", accountIndex: 4 },
      ],
      vaultPassphrase,
    });
    const vault = await service.readVault(vaultPassphrase);

    expect(accounts.map((entry) => entry.accountContractType)).toEqual(["openzeppelin", "argent"]);
    expect(vault.accounts).toEqual(accounts);
    expect(vault.activeAccountId).toBe(accounts[0]?.id ?? null);
    expect(vault.signingKeys).toHaveLength(2);
    expect(JSON.stringify(await store.get("mc-wallet:vault"))).not.toContain(mnemonic);
  });

  test("does not write a partial recovery when one derivation fails", async () => {
    const store = createMemoryStore();
    const kms: KmsPort = {
      ...indexedKms(),
      async deriveStarknetKeypair(phrase, addressIndex, accountIndex) {
        if (accountIndex === 1) throw new Error("KMS unavailable");
        return indexedKms().deriveStarknetKeypair(phrase, addressIndex, accountIndex);
      },
    };
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(store, "mc-wallet:vault"),
      kms,
      migrationStore: createEncryptedStore(store, "mc-wallet:vault-migration"),
    });

    await expect(
      service.recoverAccounts({
        mnemonic,
        networkId: "SN_MAIN",
        selections: [
          { accountContractType: "openzeppelin", accountIndex: 0 },
          { accountContractType: "argent", accountIndex: 1 },
        ],
        vaultPassphrase,
      }),
    ).rejects.toThrow("KMS unavailable");
    expect(await store.get("mc-wallet:vault")).toBeUndefined();
  });
});
