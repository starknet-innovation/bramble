/**
 * Error/guard branches inside the otherwise-covered vault methods:
 * missing-account lookups, no-account-selected returns, a KMS that yields an
 * invalid derived address, the ensure-network existing-account short circuit,
 * and duplicate-account rejections.
 */
import { describe, expect, test } from "bun:test";
import type { KrustyKms } from "../../src/crypto/krusty";
import { createEncryptedStore } from "../../src/storage/encrypted-store";
import { createMemoryStore } from "../../src/storage/kv";
import type { AccountRef, Vault } from "../../src/storage/vault-schema";
import { emptyVault } from "../../src/storage/vault-schema";
import { activeAccountSecrets, createWalletVaultService } from "../../src/wallet/vault-service";
import { fakeKms } from "../support/fake-kms";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "mc-wallet:vault";
const migrationKey = "mc-wallet:vault-migration";
const vaultPassphrase = "correct horse battery staple";

const makeService = (kms: KrustyKms = fakeKms()) => {
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
const seedVaultService = async (vault: Vault, kms: KrustyKms = fakeKms()) => {
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
  test("setActiveAccount throws when the account id is absent", async () => {
    const { service } = makeService();
    await service.createAccount({ mnemonic, vaultPassphrase });
    await expect(
      service.setActiveAccount({ accountId: "SN_MAIN:0x9", vaultPassphrase }),
    ).rejects.toThrow("Account not found");
  });

  test("createAccount rejects a duplicate account id", async () => {
    // The fake KMS returns a constant keypair, so a second createAccount derives
    // the same address/id.
    const { service } = makeService();
    await service.createAccount({ mnemonic, vaultPassphrase });
    await expect(service.createAccount({ mnemonic, vaultPassphrase })).rejects.toThrow(
      "Account already exists",
    );
  });

  test("addDerivedAccount rejects when the derived id already exists", async () => {
    const { service } = makeService();
    await service.createAccount({ mnemonic, vaultPassphrase });
    await expect(
      service.addDerivedAccount({ networkId: "SN_MAIN", vaultPassphrase }),
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
    const created = await service.createAccount({ mnemonic, vaultPassphrase });
    const same = await service.ensureNetworkAccount({ networkId: "SN_MAIN", vaultPassphrase });
    expect(same.id).toBe(created.id);
  });

  test("ensureNetworkAccount throws when the KMS returns an invalid address", async () => {
    // The SN_SEPOLIA OZ class hash routes to a zero (invalid) derived address.
    const badKms: KrustyKms = {
      ...fakeKms(),
      async deriveOzAccountAddress(publicKeyX, classHash) {
        return classHash === "0xabcdef"
          ? "0x0"
          : `0x${publicKeyX.slice(2)}${classHash.slice(2, 8)}`;
      },
    };
    const { service } = makeService(badKms);
    await service.createAccount({ mnemonic, networkId: "SN_MAIN", vaultPassphrase });
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
      address: "0xaaa",
      classHash: "0x111111",
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
      id: "SN_MAIN:0xaaa",
      networkId: "SN_MAIN",
      publicKeyX: "0xa1",
      publicKeyY: "0xa2",
    };
    const foreignSepolia: AccountRef = {
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
      schemaVersion: 4,
      signingKeys: [
        { accountId: mainnet.id, privateKey: "0x123456" },
        { accountId: foreignSepolia.id, privateKey: "0x654321" },
      ],
    };
    const collidingKms: KrustyKms = {
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
