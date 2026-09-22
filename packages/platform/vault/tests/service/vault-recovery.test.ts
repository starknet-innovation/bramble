/** Atomic multi-account recovery checks for the encrypted vault boundary. */
import { describe, expect, test } from "bun:test";
import { argentAccountAddress, familyAccountAddress } from "@bramble/starknet/account-contracts";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import { createWalletVaultService } from "@bramble/vault/service";
import {
  accountClassEntry,
  BRAAVOS_BASE_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import { sameFelt } from "@bramble/wallet-model/networks";

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
      encryptedStore: createEncryptedStore(store, "bramble:vault"),
      kms: indexedKms(),
      migrationStore: createEncryptedStore(store, "bramble:vault-migration"),
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
    expect(JSON.stringify(await store.get("bramble:vault"))).not.toContain(mnemonic);
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
      encryptedStore: createEncryptedStore(store, "bramble:vault"),
      kms,
      migrationStore: createEncryptedStore(store, "bramble:vault-migration"),
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
    expect(await store.get("bramble:vault")).toBeUndefined();
  });

  const serviceOver = (store: ReturnType<typeof createMemoryStore>) =>
    createWalletVaultService({
      encryptedStore: createEncryptedStore(store, "bramble:vault"),
      kms: indexedKms(),
      migrationStore: createEncryptedStore(store, "bramble:vault-migration"),
    });

  const argentRelease = (label: string) => {
    const entry = deploymentClasses("argent").find((candidate) => candidate.label === label);
    if (!entry) throw new Error(`${label} missing from the class table`);
    return entry;
  };

  test("restores a Ready account at the release it was deployed with", async () => {
    // Discovery found this account at Argent 0.3.0. The selection has to carry
    // that class, and the vault has to be willing to store it: without either,
    // the pick is re-derived at 0.4 or refused, and the user gets an account
    // they never chose or none at all.
    const release = argentRelease("argent 0.3.0");
    const service = serviceOver(createMemoryStore());
    const accounts = await service.recoverAccounts({
      mnemonic,
      networkId: "SN_MAIN",
      selections: [
        { accountContractType: "argent", accountIndex: 3, classHash: release.classHash },
      ],
      vaultPassphrase,
    });
    const [account] = accounts;

    expect(account?.accountContractType).toBe("argent");
    expect(sameFelt(account?.classHash ?? "", release.classHash)).toBe(true);
    const publicKey = account?.publicKeyX ?? "";
    expect(sameFelt(account?.address ?? "", familyAccountAddress(release, publicKey))).toBe(true);
    expect(sameFelt(account?.address ?? "", argentAccountAddress(publicKey))).toBe(false);
    expect((await service.readVault(vaultPassphrase)).accounts).toEqual(accounts);
  });

  test("restores a Braavos account at the class it was deployed with", async () => {
    const base = accountClassEntry(BRAAVOS_BASE_CLASS_HASH);
    if (!base) throw new Error("Braavos base class missing from the class table");
    const service = serviceOver(createMemoryStore());
    const [account] = await service.recoverAccounts({
      mnemonic,
      networkId: "SN_MAIN",
      selections: [
        { accountContractType: "braavos", accountIndex: 1, classHash: BRAAVOS_BASE_CLASS_HASH },
      ],
      vaultPassphrase,
    });

    expect(account?.accountContractType).toBe("braavos");
    expect(
      sameFelt(account?.address ?? "", familyAccountAddress(base, account?.publicKeyX ?? "")),
    ).toBe(true);
  });

  test("keeps two releases at the same index apart", async () => {
    // Same key, same index, different release: two different accounts. Keying a
    // selection on family and index alone collapsed them into one.
    const service = serviceOver(createMemoryStore());
    const accounts = await service.recoverAccounts({
      mnemonic,
      networkId: "SN_MAIN",
      selections: [
        {
          accountContractType: "argent",
          accountIndex: 2,
          classHash: argentRelease("argent 0.3.0").classHash,
        },
        {
          accountContractType: "argent",
          accountIndex: 2,
          classHash: argentRelease("argent 0.4.0").classHash,
        },
      ],
      vaultPassphrase,
    });

    expect(accounts).toHaveLength(2);
    expect(accounts[0]?.address).not.toBe(accounts[1]?.address);
  });

  test("refuses a Braavos selection that names no class", async () => {
    // This wallet never creates a Braavos account, so there is no default class
    // to fall back to: a Braavos pick without one cannot name an account.
    const store = createMemoryStore();
    await expect(
      serviceOver(store).recoverAccounts({
        mnemonic,
        networkId: "SN_MAIN",
        selections: [{ accountContractType: "braavos", accountIndex: 0 }],
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid recovery account selection");
    expect(await store.get("bramble:vault")).toBeUndefined();
  });

  test("switching network keeps each account at the class it was deployed with", async () => {
    // Projection used to re-derive without the class, landing a 0.3.0 Ready
    // account at the 0.4.0 address and refusing a Braavos one outright. And two
    // releases at one index are two accounts, so each gets its own projection.
    const service = serviceOver(createMemoryStore());
    const recovered = await service.recoverAccounts({
      mnemonic,
      networkId: "SN_MAIN",
      selections: [
        {
          accountContractType: "argent",
          accountIndex: 2,
          classHash: argentRelease("argent 0.3.0").classHash,
        },
        {
          accountContractType: "argent",
          accountIndex: 2,
          classHash: argentRelease("argent 0.4.0").classHash,
        },
        { accountContractType: "braavos", accountIndex: 1, classHash: BRAAVOS_BASE_CLASS_HASH },
      ],
      vaultPassphrase,
    });

    const projections = [];
    for (const source of recovered) {
      await service.setActiveAccount({ accountId: source.id, vaultPassphrase });
      const projected = await service.ensureNetworkAccount({
        networkId: "SN_SEPOLIA",
        vaultPassphrase,
      });
      expect(projected.networkId).toBe("SN_SEPOLIA");
      expect(projected.accountContractType).toBe(source.accountContractType);
      expect(sameFelt(projected.classHash, source.classHash)).toBe(true);
      expect(sameFelt(projected.address, source.address)).toBe(true);
      projections.push(projected.id);
    }
    expect(new Set(projections).size).toBe(recovered.length);
  });
});
