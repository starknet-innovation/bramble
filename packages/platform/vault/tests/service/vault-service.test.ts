/**
 * Vault service checks prove encrypted, permissioned account persistence.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import { activeAccountSecrets, createWalletVaultService } from "@bramble/vault/service";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "bramble:vault";
const migrationKey = "bramble:vault-migration";
const vaultPassphrase = "correct horse battery staple";
const defaultAccountInput = {
  accountContractType: "openzeppelin",
  mnemonic,
  vaultPassphrase,
} as const;
const defaultAddInput = {
  accountContractType: "openzeppelin",
  networkId: "SN_MAIN",
  vaultPassphrase,
} as const;

// KMS whose keypair varies by account index so derived accounts stay distinct.
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

describe("createWalletVaultService", () => {
  test("creates encrypted account metadata", async () => {
    const store = createMemoryStore();
    const encryptedStore = createEncryptedStore(store, vaultKey);
    const service = createWalletVaultService({
      encryptedStore,
      kms: fakeKms(),
      migrationStore: createEncryptedStore(store, migrationKey),
    });

    const account = await service.createAccount(defaultAccountInput);
    const raw = JSON.stringify(await store.get(vaultKey));
    const vault = await service.readVault(vaultPassphrase);

    expect(account.id).toBe("SN_MAIN:0xabc111111");
    expect(raw).not.toContain(mnemonic);
    expect(raw).not.toContain(account.address);
    expect(raw).not.toContain("0x123456");
    expect(vault.accounts).toEqual([account]);
    expect(vault.activeAccountId).toBe(account.id);
    expect(vault.originGrants).toEqual([]);
    expect(vault.signingKeys).toEqual([{ accountId: account.id, privateKey: "0x123456" }]);
  });

  test("stores the recovery phrase in the encrypted vault", async () => {
    const store = createMemoryStore();
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(store, vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(store, migrationKey),
    });

    await service.createAccount(defaultAccountInput);
    const vault = await service.readVault(vaultPassphrase);

    expect(vault.mnemonic).toBe(mnemonic);
    expect(JSON.stringify(await store.get(vaultKey))).not.toContain(mnemonic);
  });

  test("previews public account metadata without creating a vault", async () => {
    const store = createMemoryStore();
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(store, vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(store, migrationKey),
    });

    await expect(
      service.previewAccount({
        accountContractType: "openzeppelin",
        mnemonic,
        networkId: "SN_SEPOLIA",
      }),
    ).resolves.toMatchObject({
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
      networkId: "SN_SEPOLIA",
      publicKeyX: "0xabc",
    });
    expect(await store.get(vaultKey)).toBeUndefined();
  });

  test("adds the next derived account on a network from the stored phrase", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: indexedKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const first = await service.createAccount(defaultAccountInput);
    const second = await service.addDerivedAccount(defaultAddInput);
    const third = await service.addDerivedAccount(defaultAddInput);

    expect(second.derivation.accountIndex).toBe(1);
    expect(third.derivation.accountIndex).toBe(2);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts).toEqual([first, second, third]);
    expect(vault.activeAccountId).toBe(third.id);
    expect(vault.signingKeys.map((key) => key.accountId)).toEqual([first.id, second.id, third.id]);
  });

  test("counts unused account indexes per network independently", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: indexedKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    const sepolia = await service.addDerivedAccount({
      accountContractType: "openzeppelin",
      networkId: "SN_SEPOLIA",
      vaultPassphrase,
    });

    expect(sepolia.derivation.accountIndex).toBe(0);
    expect(sepolia.networkId).toBe("SN_SEPOLIA");
  });

  test("refuses to add accounts without a stored recovery phrase", async () => {
    const encryptedStore = createEncryptedStore(createMemoryStore(), vaultKey);
    await encryptedStore.write(
      { accounts: [], activeAccountId: null, originGrants: [], schemaVersion: 1, signingKeys: [] },
      vaultPassphrase,
    );
    const service = createWalletVaultService({
      encryptedStore,
      kms: indexedKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await expect(service.addDerivedAccount(defaultAddInput)).rejects.toThrow(
      "No recovery phrase stored for this wallet",
    );
  });

  test("exposes the active account key and phrase to the reveal flow", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await service.createAccount(defaultAccountInput);
    const secrets = activeAccountSecrets(await service.readVault(vaultPassphrase));

    expect(secrets).toEqual({ mnemonic, privateKey: "0x123456" });
  });

  test("derives a STRK20 viewing key inside the encrypted vault boundary", async () => {
    let derivationSeen: readonly string[] = [];
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: {
        ...fakeKms(),
        async deriveStrk20ViewingKey(privateKey, chainId, poolAddress) {
          derivationSeen = [privateKey, chainId, poolAddress];
          return "0x654321";
        },
      },
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });
    const account = await service.createAccount(defaultAccountInput);
    await expect(
      service.deriveStrk20ViewingKey({
        accountId: account.id,
        chainId: "0x534e5f5345504f4c4941",
        poolAddress: "0x123",
        vaultPassphrase,
      }),
    ).resolves.toBe("0x654321");
    expect(derivationSeen).toEqual(["0x123456", "0x534e5f5345504f4c4941", "0x123"]);
  });
  test("grants origins access only to selected accounts", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const account = await service.createAccount(defaultAccountInput);

    await expect(
      service.grantOrigin({
        origin: "https://example.com",
        vaultPassphrase,
      }),
    ).resolves.toEqual([account]);
    await expect(
      service.getGrantedAccounts("https://example.com", vaultPassphrase),
    ).resolves.toEqual([account]);
    await expect(
      service.getGrantedAccounts("https://evil.example", vaultPassphrase),
    ).resolves.toEqual([]);
    await expect(
      service.grantOrigin({
        origin: "http://127.0.0.1:5173",
        vaultPassphrase,
      }),
    ).resolves.toEqual([account]);
  });

  test("rejects insecure origin grants", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await service.createAccount(defaultAccountInput);

    await expect(
      service.grantOrigin({
        origin: "http://example.com",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid origin");
    await expect(service.getGrantedAccounts("http://example.com", vaultPassphrase)).rejects.toThrow(
      "Invalid origin",
    );
  });

  test("rejects malformed account ids before account lookup", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await service.createAccount(defaultAccountInput);

    await expect(
      service.grantOrigin({
        accountId: "not-an-account",
        origin: "https://example.com",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid account id");
    await expect(
      service.signHash({
        accountId: "not-an-account",
        messageHash: "0x1234",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid account id");
  });

  test("rejects short passphrases before KMS derivation", async () => {
    let derived = false;
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: {
        ...fakeKms(),
        async deriveStarknetKeypair() {
          derived = true;
          return fakeKms().deriveStarknetKeypair(mnemonic, 0, 0);
        },
      },
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await expect(
      service.createAccount({
        accountContractType: "openzeppelin",
        mnemonic,
        vaultPassphrase: "too short",
      }),
    ).rejects.toThrow("Passphrase must be at least 12 characters");
    expect(derived).toBe(false);
  });

  test("sets the active account in the encrypted vault", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const sepolia = await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_SEPOLIA",
      vaultPassphrase,
    });
    const mainnet = await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_MAIN",
      vaultPassphrase,
    });

    await expect(
      service.setActiveAccount({ accountId: mainnet.id, vaultPassphrase }),
    ).resolves.toEqual(mainnet);
    await expect(service.readVault(vaultPassphrase)).resolves.toMatchObject({
      accounts: [sepolia, mainnet],
      activeAccountId: mainnet.id,
    });
  });

  test("derives the selected account onto another network without the mnemonic", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const mainnet = await service.createAccount(defaultAccountInput);
    const sepolia = await service.ensureNetworkAccount({
      networkId: "SN_SEPOLIA",
      vaultPassphrase,
    });

    expect(sepolia).toMatchObject({
      address: "0xabcabcdef",
      classHash: "0xabcdef",
      derivation: mainnet.derivation,
      networkId: "SN_SEPOLIA",
      publicKeyX: mainnet.publicKeyX,
      publicKeyY: mainnet.publicKeyY,
    });
    await expect(service.readVault(vaultPassphrase)).resolves.toMatchObject({
      activeAccountId: sepolia.id,
      accounts: [mainnet, sepolia],
      signingKeys: [
        { accountId: mainnet.id, privateKey: "0x123456" },
        { accountId: sepolia.id, privateKey: "0x123456" },
      ],
    });
  });

  test("signs hashes with the encrypted account key", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const account = await service.createAccount(defaultAccountInput);

    await expect(
      service.signHash({
        accountId: account.id,
        messageHash: "0x1234",
        vaultPassphrase,
      }),
    ).resolves.toEqual({
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    });
  });

  test("rejects invalid message hashes before signing", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    const account = await service.createAccount(defaultAccountInput);

    await expect(
      service.signHash({
        accountId: account.id,
        messageHash: "0x800000000000011000000000000000000000000000000000000000000000001",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid message hash");
  });

  test("serializes concurrent mutations so neither write is lost", async () => {
    // An encrypted-store stand-in with real async latency: reads snapshot the
    // stored value before yielding, so two unserialized read-modify-write
    // mutations would base their writes on the same stale vault and the
    // second write would silently erase the first.
    const delay = () => new Promise((resolve) => setTimeout(resolve, 5));
    let stored: unknown;
    const slowStore = {
      clearKeys() {},
      async exists() {
        return stored !== undefined;
      },
      async read(_passphrase: string) {
        const snapshot = stored;
        await delay();
        return snapshot;
      },
      async remove() {
        stored = undefined;
      },
      async upgradeLegacyEnvelope() {},
      async write(value: unknown, _passphrase: string) {
        await delay();
        stored = JSON.parse(JSON.stringify(value));
      },
    };
    const service = createWalletVaultService({
      encryptedStore: slowStore as never,
      kms: indexedKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await service.createAccount(defaultAccountInput);
    await Promise.all([
      service.grantOrigin({ origin: "https://alpha.example", vaultPassphrase }),
      service.addDerivedAccount(defaultAddInput),
    ]);

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts).toHaveLength(2);
    expect(vault.originGrants.map((grant) => grant.origin)).toEqual(["https://alpha.example"]);
  });

  test("queues legacy KDF upgrades so passive reads cannot clobber mutations", async () => {
    let stored: unknown;
    let legacyEnvelope = false;
    let releaseUpgrade: () => void = () => {};
    let noteUpgradeStarted: () => void = () => {};
    const upgradeStarted = new Promise<void>((resolve) => {
      noteUpgradeStarted = resolve;
    });
    const upgradeMayFinish = new Promise<void>((resolve) => {
      releaseUpgrade = resolve;
    });
    const clone = (value: unknown): unknown =>
      value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
    const controlledStore = {
      clearKeys() {},
      async exists() {
        return stored !== undefined;
      },
      async read(_passphrase: string) {
        return clone(stored);
      },
      async remove() {
        stored = undefined;
      },
      async upgradeLegacyEnvelope(_passphrase: string) {
        if (!legacyEnvelope) {
          return;
        }
        const snapshot = clone(stored);
        legacyEnvelope = false;
        noteUpgradeStarted();
        await upgradeMayFinish;
        stored = snapshot;
      },
      async write(value: unknown, _passphrase: string) {
        stored = clone(value);
      },
    };
    const service = createWalletVaultService({
      encryptedStore: controlledStore as never,
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
    });

    await service.createAccount(defaultAccountInput);
    legacyEnvelope = true;
    const passiveRead = service.readVault(vaultPassphrase);
    await upgradeStarted;
    const grant = service.grantOrigin({
      origin: "https://alpha.example",
      vaultPassphrase,
    });

    releaseUpgrade();
    await Promise.all([passiveRead, grant]);

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.originGrants.map((originGrant) => originGrant.origin)).toEqual([
      "https://alpha.example",
    ]);
  });
});
