/**
 * Vault-service coverage for the mnemonic-less Ledger vault: `createLedgerVault`
 * builds a brand-new encrypted vault whose only account is a keyless Ledger
 * account, holding no recovery phrase and no signing key; it refuses to run over
 * an existing wallet; and such a vault stays read-only for phrase operations
 * (the fail-closed edge for adding a seed account later).
 */
import { describe, expect, test } from "bun:test";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";
import { createEncryptedStore } from "../../src/storage/encrypted-store";
import { createMemoryStore } from "../../src/storage/kv";
import { isVaultV3 } from "../../src/storage/vault-schema";
import { createWalletVaultService } from "../../src/wallet/vault-service";
import { fakeKms } from "../support/fake-kms";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "mc-wallet:vault";
const vaultPassphrase = "correct horse battery staple";

const makeService = (store = createMemoryStore()) => ({
  service: createWalletVaultService({
    encryptedStore: createEncryptedStore(store, vaultKey),
    kms: fakeKms(),
  }),
  store,
});

describe("createLedgerVault", () => {
  test("creates a mnemonic-less vault whose first account is a keyless Ledger", async () => {
    const { service, store } = makeService();

    const account = await service.createLedgerVault({
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
    expect(isVaultV3(vault)).toBe(true);
    // The passphrase encrypts the registry; it is never persisted in the clear.
    expect(JSON.stringify(await store.get(vaultKey))).not.toContain(vaultPassphrase);
  });

  test("refuses to create a Ledger vault over an existing seeded wallet", async () => {
    const { service } = makeService();

    await service.createAccount({ mnemonic, vaultPassphrase });
    await expect(
      service.createLedgerVault({
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
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });
    await expect(
      service.createLedgerVault({
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
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });

    // Fail-closed edge: adding an HD account needs a phrase this vault does not
    // hold, and none is fabricated behind the user's back.
    await expect(
      service.addDerivedAccount({ networkId: "SN_MAIN", vaultPassphrase }),
    ).rejects.toThrow("No recovery phrase stored for this wallet");
  });

  test("a keyless Ledger account cannot derive a STRK20 viewing key", async () => {
    const { service } = makeService();
    const account = await service.createLedgerVault({
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
    ).rejects.toThrow("STRK20 is unavailable for keyless accounts");
  });
});

describe("ensureNetworkAccount for a keyless Ledger account", () => {
  test("derives a new keyless Ledger account on a fresh network with no signing key", async () => {
    const { service } = makeService();
    const mainnet = await service.createLedgerVault({
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
    expect(isVaultV3(vault)).toBe(true);
  });
});
