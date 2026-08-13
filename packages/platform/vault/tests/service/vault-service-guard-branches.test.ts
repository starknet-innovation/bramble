/**
 * Error/guard branches inside the otherwise-covered vault methods:
 * missing-account lookups, no-account-selected returns, a KMS that yields an
 * invalid derived address, the ensure-network existing-account short circuit,
 * and duplicate-account rejections.
 */
import { describe, expect, test } from "bun:test";
import { ARGENT_ACCOUNT_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { fakeKms } from "@mc-wallet/testkit/fake-kms";
import { createEncryptedStore } from "@mc-wallet/vault/encrypted-store";
import type { KmsPort } from "@mc-wallet/vault/kms-port";
import type { Vault } from "@mc-wallet/vault/schema";
import { emptyVault } from "@mc-wallet/vault/schema";
import { activeAccountSecrets, createWalletVaultService } from "@mc-wallet/vault/service";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "mc-wallet:vault";
const migrationKey = "mc-wallet:vault-migration";
const vaultPassphrase = "correct horse battery staple";
const defaultAccountInput = {
  accountContractType: "openzeppelin",
  mnemonic,
  vaultPassphrase,
} as const;

const makeService = (kms: KmsPort = fakeKms()) => {
  const store = createMemoryStore();
  const encryptedStore = createEncryptedStore(store, vaultKey);
  const service = createWalletVaultService({
    encryptedStore,
    kms,
    migrationStore: createEncryptedStore(store, migrationKey),
  });
  return { encryptedStore, service };
};

// Seeds an already-persisted empty vault (no accounts, no active account) so
// the no-account-selected branches can be reached — a fresh store would throw
// on read instead.
const seedEmptyService = async () => {
  const store = createMemoryStore();
  const encryptedStore = createEncryptedStore(store, vaultKey);
  await encryptedStore.write(emptyVault(), vaultPassphrase);
  return createWalletVaultService({
    encryptedStore,
    kms: fakeKms(),
    migrationStore: createEncryptedStore(store, migrationKey),
  });
};

// Persists an arbitrary (schema-valid) vault, then wires a service over the same
// store so ensure/derive paths read exactly that seeded state.
const seedVaultService = async (vault: Vault, kms: KmsPort = fakeKms()) => {
  const store = createMemoryStore();
  const encryptedStore = createEncryptedStore(store, vaultKey);
  await encryptedStore.write(vault, vaultPassphrase);
  return createWalletVaultService({
    encryptedStore,
    kms,
    migrationStore: createEncryptedStore(store, migrationKey),
  });
};

describe("vault service guard branches", () => {
  test("generates mnemonics through KMS", async () => {
    const { service } = makeService();
    await expect(service.generateMnemonic()).resolves.toBe(mnemonic);
  });

  test("fails closed for direct popup vault access", () => {
    const { encryptedStore } = makeService();
    expect(() =>
      createWalletVaultService({
        actor: "popup",
        encryptedStore,
        kms: fakeKms(),
        migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
      }),
    ).toThrow("Storage access denied");
  });

  test("setActiveAccount throws when the account id is absent", async () => {
    const { service } = makeService();
    await service.createAccount(defaultAccountInput);
    await expect(
      service.setActiveAccount({ accountId: "SN_MAIN:0x9", vaultPassphrase }),
    ).rejects.toThrow("Account not found");
  });

  test("createAccount rejects a duplicate account id", async () => {
    // The fake KMS returns a constant keypair, so a second createAccount derives
    // the same address/id.
    const { service } = makeService();
    await service.createAccount(defaultAccountInput);
    await expect(service.createAccount(defaultAccountInput)).rejects.toThrow(
      "Account already exists",
    );
  });

  test("addDerivedAccount rejects when the derived id already exists", async () => {
    const { service } = makeService();
    await service.createAccount(defaultAccountInput);
    await expect(
      service.addDerivedAccount({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Account already exists");
  });

  test("ensureNetworkAccount throws when the vault has no source account", async () => {
    const service = await seedEmptyService();
    await expect(
      service.ensureNetworkAccount({ networkId: "SN_MAIN", vaultPassphrase }),
    ).rejects.toThrow("No account selected");
  });

  test("ensureNetworkAccount returns the existing same-network account", async () => {
    const { service } = makeService();
    const created = await service.createAccount(defaultAccountInput);
    const same = await service.ensureNetworkAccount({ networkId: "SN_MAIN", vaultPassphrase });
    expect(same.id).toBe(created.id);
  });

  test("ensureNetworkAccount preserves Argent contract semantics", async () => {
    const { service } = makeService();
    const mainnet = await service.createAccount({
      accountContractType: "argent",
      mnemonic,
      vaultPassphrase,
    });
    const sepolia = await service.ensureNetworkAccount({
      networkId: "SN_SEPOLIA",
      vaultPassphrase,
    });

    expect(sepolia).toMatchObject({
      accountContractType: "argent",
      address: mainnet.address,
      networkId: "SN_SEPOLIA",
    });
    expect(sameFelt(sepolia.classHash, ARGENT_ACCOUNT_CONTRACT.classHash)).toBe(true);
  });

  test("ensureNetworkAccount throws when the KMS returns an invalid address", async () => {
    // The SN_SEPOLIA OZ class hash routes to a zero (invalid) derived address.
    const badKms: KmsPort = {
      ...fakeKms(),
      async deriveOzAccountAddress(publicKeyX, classHash) {
        return classHash === "0xabcdef"
          ? "0x0"
          : `0x${publicKeyX.slice(2)}${classHash.slice(2, 8)}`;
      },
    };
    const { service } = makeService(badKms);
    await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    await expect(
      service.ensureNetworkAccount({ networkId: "SN_SEPOLIA", vaultPassphrase }),
    ).rejects.toThrow("invalid account address");
  });

  test("ensureNetworkAccount rejects a derived address that collides with a foreign account", async () => {
    // Two accounts hold different keypairs, but a misbehaving KMS derives an
    // address equal to the existing Sepolia account's. That account is keyed
    // differently, so the same-key short circuit misses it and the id-collision
    // guard must reject the duplicate rather than overwrite it.
    const mainnet: AccountRef = {
      accountContractType: "openzeppelin",
      address: "0xaaa",
      classHash: "0x111111",
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
      id: "SN_MAIN:0xaaa",
      networkId: "SN_MAIN",
      publicKeyX: "0xa1",
      publicKeyY: "0xa2",
    };
    const foreignSepolia: AccountRef = {
      accountContractType: "openzeppelin",
      address: "0xbbb",
      classHash: "0xabcdef",
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
      id: "SN_SEPOLIA:0xbbb",
      networkId: "SN_SEPOLIA",
      publicKeyX: "0xb1",
      publicKeyY: "0xb2",
    };
    const seeded: Vault = {
      accounts: [mainnet, foreignSepolia],
      accountSecrets: [],
      activeAccountId: mainnet.id,
      mnemonic: null,
      originGrants: [],
      schemaVersion: 7,
      signingKeys: [
        { accountId: mainnet.id, privateKey: "0x123456" },
        { accountId: foreignSepolia.id, privateKey: "0x654321" },
      ],
    };
    const collidingKms: KmsPort = {
      ...fakeKms(),
      async deriveOzAccountAddress() {
        return foreignSepolia.address;
      },
    };
    const service = await seedVaultService(seeded, collidingKms);
    await expect(
      service.ensureNetworkAccount({ networkId: "SN_SEPOLIA", vaultPassphrase }),
    ).rejects.toThrow("Account already exists");
  });

  test("grantOrigin throws when no account is selected", async () => {
    const service = await seedEmptyService();
    await expect(
      service.grantOrigin({ origin: "https://dapp.example", vaultPassphrase }),
    ).rejects.toThrow("No account selected");
  });

  test("signHash throws when no account is selected", async () => {
    const service = await seedEmptyService();
    await expect(service.signHash({ messageHash: "0x1", vaultPassphrase })).rejects.toThrow(
      "No account selected",
    );
  });
});

describe("activeAccountSecrets guard branches", () => {
  test("throws when no account is selected", () => {
    expect(() => activeAccountSecrets(emptyVault())).toThrow("No account selected");
  });

  test("throws when the active account has no signing key", () => {
    const vault = {
      ...emptyVault(),
      activeAccountId: "SN_MAIN:0x1",
      signingKeys: [],
    } as unknown as Vault;
    expect(() => activeAccountSecrets(vault)).toThrow("Signing key unavailable");
  });
});
