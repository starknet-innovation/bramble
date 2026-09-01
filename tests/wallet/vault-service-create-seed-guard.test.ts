/**
 * MCW-V09-128: `createAccount` is the first-run recovery-phrase path, so it
 * must never quietly seed a wallet that already exists — the symmetric guard to
 * `createLedgerVault`'s. A second, different phrase would leave accounts in the
 * vault that the phrase the user backed up cannot reproduce, and a phrase
 * written over a keyless Ledger vault would do the same to its device accounts.
 * Re-deriving the same wallet from the same phrase stays allowed.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { fakeKms } from "@mc-wallet/testkit/fake-kms";
import { createEncryptedStore } from "@mc-wallet/vault/encrypted-store";
import type { KmsPort } from "@mc-wallet/vault/kms-port";
import { createWalletVaultService } from "@mc-wallet/vault/service";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const otherMnemonic = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const vaultKey = "mc-wallet:vault";
const migrationKey = "mc-wallet:vault-migration";
const vaultPassphrase = "correct horse battery staple";

// The shared fake returns one constant keypair for every phrase, which would
// mask a foreign seed behind the duplicate-account-id check. This one derives a
// distinct account from a second phrase, so an unguarded create really does
// write an account the stored phrase cannot reproduce.
const phraseBoundKms = (): KmsPort => ({
  ...fakeKms(),
  async deriveStarknetKeypair(phrase, addressIndex, accountIndex) {
    return phrase === mnemonic
      ? fakeKms().deriveStarknetKeypair(phrase, addressIndex, accountIndex)
      : { privateKey: "0x999999", publicKeyX: "0xfeed", publicKeyY: "0xface" };
  },
});

const makeService = (kms: KmsPort = fakeKms()) => {
  const store = createMemoryStore();
  return createWalletVaultService({
    encryptedStore: createEncryptedStore(store, vaultKey),
    kms,
    migrationStore: createEncryptedStore(store, migrationKey),
  });
};

describe("createAccount seed guard", () => {
  test("refuses a different recovery phrase over an existing seeded wallet", async () => {
    const service = makeService(phraseBoundKms());
    const first = await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      vaultPassphrase,
    });

    await expect(
      service.createAccount({
        accountContractType: "openzeppelin",
        mnemonic: otherMnemonic,
        vaultPassphrase,
      }),
    ).rejects.toThrow("Wallet already exists");

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.mnemonic).toBe(mnemonic);
    expect(vault.accounts).toEqual([first]);
    expect(vault.signingKeys).toHaveLength(1);
  });

  test("refuses to seed a phrase into an existing keyless Ledger vault", async () => {
    const service = makeService();
    const ledger = await service.createLedgerVault({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xdef123",
      vaultPassphrase,
    });

    await expect(
      service.createAccount({
        accountContractType: "openzeppelin",
        mnemonic,
        vaultPassphrase,
      }),
    ).rejects.toThrow("Wallet already exists");

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.mnemonic).toBeNull();
    expect(vault.accounts).toEqual([ledger]);
    expect(vault.signingKeys).toEqual([]);
  });

  test("still creates the first wallet and re-derives it on another network", async () => {
    const service = makeService();

    const mainnet = await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_MAIN",
      vaultPassphrase,
    });
    const sepolia = await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_SEPOLIA",
      vaultPassphrase,
    });

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.mnemonic).toBe(mnemonic);
    expect(vault.accounts).toEqual([mainnet, sepolia]);
  });
});
