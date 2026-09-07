/**
 * Vault-service coverage for the mnemonic-less Ledger vault: `createLedgerVault`
 * builds a brand-new encrypted vault whose only account is a keyless Ledger
 * account, holding no recovery phrase and no signing key; it refuses to run over
 * an existing wallet; and such a vault stays read-only for phrase operations
 * (the fail-closed edge for adding a seed account later).
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { MAX_LEDGER_STRK20_VIEWING_KEYS } from "@bramble/vault/account-secrets";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { isVaultV8 } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "bramble:vault";
const migrationKey = "bramble:vault-migration";
const vaultPassphrase = "correct horse battery staple";

const makeService = (store = createMemoryStore()) => ({
  service: createWalletVaultService({
    encryptedStore: createEncryptedStore(store, vaultKey),
    kms: fakeKms(),
    migrationStore: createEncryptedStore(store, migrationKey),
  }),
  store,
});

describe("createLedgerVault", () => {
  test("creates a mnemonic-less vault whose first account is a keyless Ledger", async () => {
    const { service, store } = makeService();

    const account = await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });

    expect(account.derivation).toEqual({
      accountIndex: 0,
      eip2645application: "LedgerW",
      kind: "ledger",
      path: ledgerAccountPath(0),
    });
    const vault = await service.readVault(vaultPassphrase);
    // No seed and no signing key are generated: the vault holds only public
    // metadata for a device that signs on its own.
    expect(vault.mnemonic).toBeNull();
    expect(vault.signingKeys).toEqual([]);
    expect(vault.accounts).toEqual([account]);
    expect(vault.activeAccountId).toBe(account.id);
    expect(isVaultV8(vault)).toBe(true);
    // The passphrase encrypts the registry; it is never persisted in the clear.
    expect(JSON.stringify(await store.get(vaultKey))).not.toContain(vaultPassphrase);
  });

  test("refuses to create a Ledger vault over an existing seeded wallet", async () => {
    const { service } = makeService();

    await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      vaultPassphrase,
    });
    await expect(
      service.createLedgerVault({
        accountContractType: "openzeppelin",
        accountIndex: 0,
        networkId: "SN_MAIN",
        publicKeyX: "0xdef123",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Wallet already exists");
  });

  test("refuses to create a Ledger vault over an existing Ledger-only wallet", async () => {
    const { service } = makeService();

    await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });
    await expect(
      service.createLedgerVault({
        accountContractType: "openzeppelin",
        accountIndex: 1,
        networkId: "SN_MAIN",
        publicKeyX: "0xdef456",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Wallet already exists");
  });

  test("a Ledger-only vault stays read-only for recovery-phrase operations", async () => {
    const { service } = makeService();

    await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });

    // Fail-closed edge: adding an HD account needs a phrase this vault does not
    // hold, and none is fabricated behind the user's back.
    await expect(
      service.addDerivedAccount({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        vaultPassphrase,
      }),
    ).rejects.toThrow("No recovery phrase stored for this wallet");
  });

  test("a Ledger account fails closed until its scoped STRK20 viewing key is retained", async () => {
    const { service } = makeService();
    const account = await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });

    await expect(
      service.deriveStrk20ViewingKey({
        accountId: account.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "0x123",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Ledger STRK20 viewing key unavailable");
  });

  test("retains a Ledger viewing key only in encrypted account secrets", async () => {
    const { service, store } = makeService();
    const account = await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });

    await service.storeLedgerStrk20ViewingKey({
      accountId: account.id,
      chainId: "0x534e5f4d41494e",
      poolAddress: "0x0123",
      vaultPassphrase,
      viewingKey: "0x0654321",
    });

    await expect(
      service.deriveStrk20ViewingKey({
        accountId: account.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "0x123",
        vaultPassphrase,
      }),
    ).resolves.toBe("0x654321");

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accountSecrets).toEqual([
      {
        accountId: account.id,
        ledgerStrk20ViewingKeys: [
          {
            chainId: "0x534e5f4d41494e",
            poolAddress: "0x123",
            scheme: "ledger-strk20-typed-data-v1",
            viewingKey: "0x654321",
          },
        ],
      },
    ]);
    expect(JSON.stringify(vault.accounts)).not.toContain("0x654321");
    expect(JSON.stringify(await store.get(vaultKey))).not.toContain("0x654321");
  });

  test("isolates retained keys by account, chain, and pool and supports forgetting", async () => {
    const { service } = makeService();
    const first = await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });
    const second = await service.addLedgerAccount({
      accountContractType: "openzeppelin",
      accountIndex: 1,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef456",
      vaultPassphrase,
    });
    await service.storeLedgerStrk20ViewingKey({
      accountId: first.id,
      chainId: "0x534e5f4d41494e",
      poolAddress: "0x123",
      vaultPassphrase,
      viewingKey: "0x654321",
    });

    await expect(
      service.deriveStrk20ViewingKey({
        accountId: second.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "0x123",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Ledger STRK20 viewing key unavailable");
    await expect(
      service.deriveStrk20ViewingKey({
        accountId: first.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "0x456",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Ledger STRK20 viewing key unavailable");

    await expect(
      service.forgetLedgerStrk20ViewingKey({
        accountId: first.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "0x123",
        vaultPassphrase,
      }),
    ).resolves.toBe(true);
    expect((await service.readVault(vaultPassphrase)).accountSecrets).toEqual([]);
    await expect(
      service.forgetLedgerStrk20ViewingKey({
        accountId: first.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "0x123",
        vaultPassphrase,
      }),
    ).resolves.toBe(false);
  });

  test("replaces one scope atomically and rejects capacity overflow without eviction", async () => {
    const { service } = makeService();
    const account = await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });
    const retain = (poolAddress: string, viewingKey: string) =>
      service.storeLedgerStrk20ViewingKey({
        accountId: account.id,
        chainId: "0x534e5f4d41494e",
        poolAddress,
        vaultPassphrase,
        viewingKey,
      });

    await retain("0x100", "0x200");
    await retain("0x100", "0x201");
    await expect(
      service.deriveStrk20ViewingKey({
        accountId: account.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "0x100",
        vaultPassphrase,
      }),
    ).resolves.toBe("0x201");

    for (let index = 1; index < MAX_LEDGER_STRK20_VIEWING_KEYS; index += 1) {
      await retain(`0x${(0x100 + index).toString(16)}`, `0x${(0x201 + index).toString(16)}`);
    }
    const before = await service.readVault(vaultPassphrase);
    await expect(retain("0x200", "0x300")).rejects.toThrow(
      "Ledger STRK20 viewing-key limit reached",
    );
    expect(await service.readVault(vaultPassphrase)).toEqual(before);
  }, 20_000);

  test("rejects wrong-network, malformed, and software-account key retention", async () => {
    const { service } = makeService();
    const ledger = await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });
    await expect(
      service.storeLedgerStrk20ViewingKey({
        accountId: ledger.id,
        chainId: "0x534e5f5345504f4c4941",
        poolAddress: "0x123",
        vaultPassphrase,
        viewingKey: "0x654321",
      }),
    ).rejects.toThrow("Invalid Ledger STRK20 viewing key");
    await expect(
      service.storeLedgerStrk20ViewingKey({
        accountId: ledger.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "not-a-pool",
        vaultPassphrase,
        viewingKey: "0x654321",
      }),
    ).rejects.toThrow("Invalid Ledger STRK20 viewing key");

    const softwareService = makeService().service;
    const software = await softwareService.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      vaultPassphrase,
    });
    await expect(
      softwareService.storeLedgerStrk20ViewingKey({
        accountId: software.id,
        chainId: "0x534e5f4d41494e",
        poolAddress: "0x123",
        vaultPassphrase,
        viewingKey: "0x654321",
      }),
    ).rejects.toThrow("Account is not a Ledger account");
  });
});

describe("ensureNetworkAccount for a keyless Ledger account", () => {
  test("derives a new keyless Ledger account on a fresh network with no signing key", async () => {
    const { service } = makeService();
    const mainnet = await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });

    // Switching a keyless Ledger account to a network it has no account on must
    // derive the counterfactual account from the stored device publicKeyX + the
    // TARGET network's class hash — never throw "Signing key unavailable"
    // (a Ledger account holds no signing key by design).
    const sepolia = await service.ensureNetworkAccount({
      networkId: "SN_SEPOLIA",
      vaultPassphrase,
    });

    // Address = fake-KMS(publicKeyX, SN_SEPOLIA class hash) = "0xdef123" body +
    // "abcdef" (SN_SEPOLIA OZ class hash slice), so the address tracks the target
    // network's class hash, not mainnet's. The device derivation metadata (index,
    // application, path) is rebuilt deterministically for the same device slot.
    expect(sepolia).toEqual({
      accountContractType: "openzeppelin",
      address: "0xdef123abcdef",
      classHash: "0xabcdef",
      derivation: {
        accountIndex: 0,
        eip2645application: "LedgerW",
        kind: "ledger",
        path: ledgerAccountPath(0),
      },
      id: "SN_SEPOLIA:0xdef123abcdef",
      networkId: "SN_SEPOLIA",
      publicKeyX: "0xdef123",
    });

    const vault = await service.readVault(vaultPassphrase);
    // Still keyless on the new network: no signing-key entry is created for it.
    expect(vault.signingKeys).toEqual([]);
    expect(vault.accounts).toEqual([mainnet, sepolia]);
    expect(vault.activeAccountId).toBe(sepolia.id);
    expect(isVaultV8(vault)).toBe(true);
  });
});
