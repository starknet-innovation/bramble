/**
 * Vault service checks prove encrypted, permissioned account persistence.
 */
import { describe, expect, test } from "bun:test";
import { createEncryptedStore } from "../src/storage/encrypted-store";
import { createMemoryStore } from "../src/storage/kv";
import { createWalletVaultService } from "../src/wallet/vault-service";
import { fakeKms } from "./fake-kms";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "mc-wallet:vault";
const vaultPassphrase = "correct horse battery staple";

describe("createWalletVaultService", () => {
  test("creates encrypted account metadata", async () => {
    const store = createMemoryStore();
    const encryptedStore = createEncryptedStore(store, vaultKey);
    const service = createWalletVaultService({ encryptedStore, kms: fakeKms() });

    const account = await service.createAccount({ mnemonic, vaultPassphrase });
    const raw = JSON.stringify(await store.get(vaultKey));
    const vault = await service.readVault(vaultPassphrase);

    expect(account.id).toBe("SN_SEPOLIA:0xabcabcdef");
    expect(raw).not.toContain(mnemonic);
    expect(raw).not.toContain(account.address);
    expect(raw).not.toContain("0x123456");
    expect(vault.accounts).toEqual([account]);
    expect(vault.activeAccountId).toBe(account.id);
    expect(vault.originGrants).toEqual([]);
    expect(vault.signingKeys).toEqual([{ accountId: account.id, privateKey: "0x123456" }]);
  });

  test("grants origins access only to selected accounts", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
    });

    const account = await service.createAccount({ mnemonic, vaultPassphrase });

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
    });

    await service.createAccount({ mnemonic, vaultPassphrase });

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
    });

    await service.createAccount({ mnemonic, vaultPassphrase });

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
    });

    await expect(
      service.createAccount({
        mnemonic,
        vaultPassphrase: "too short",
      }),
    ).rejects.toThrow("Passphrase must be at least 12 characters");
    expect(derived).toBe(false);
  });

  test("signs hashes with the encrypted account key", async () => {
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
      kms: fakeKms(),
    });

    const account = await service.createAccount({ mnemonic, vaultPassphrase });

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
    });

    const account = await service.createAccount({ mnemonic, vaultPassphrase });

    await expect(
      service.signHash({
        accountId: account.id,
        messageHash: "0x800000000000011000000000000000000000000000000000000000000000001",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid message hash");
  });

  test("fails closed for direct popup vault access", () => {
    const encryptedStore = createEncryptedStore(createMemoryStore(), vaultKey);

    expect(() =>
      createWalletVaultService({ actor: "popup", encryptedStore, kms: fakeKms() }),
    ).toThrow("Storage access denied");
  });
});
