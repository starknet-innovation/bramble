/**
 * The vault service never loses a QSB account: fresh-store creation paths
 * refuse a vault that already holds one (its phrase and the id naming its
 * journal), ordinary mutations carry it through untouched, and a Starknet
 * phrase that is a QSB account's dedicated phrase is refused before anything
 * is written.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { emptyVault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { PHRASE_A, writerAccount } from "./qsb-fixtures";

const vaultKey = "bramble:vault";
const vaultPassphrase = "correct horse battery staple";
const STARKNET_PHRASE =
  "habit hope tip crystal because grunt nation idea electric witness alert like";
const qsbAccount = writerAccount();

// A vault holding only a QSB account, written straight to the encrypted store
// as a later QSB writer would (its journal lives under its own key).
const serviceOverQsbVault = async () => {
  const store = createMemoryStore();
  await createEncryptedStore(store, vaultKey).write(
    { ...emptyVault(), qsbAccounts: [qsbAccount] },
    vaultPassphrase,
  );
  return createWalletVaultService({
    encryptedStore: createEncryptedStore(store, vaultKey),
    kms: fakeKms(),
    migrationStore: createEncryptedStore(store, "bramble:vault-migration"),
  });
};

describe("QSB accounts in the vault service", () => {
  test("fresh-store creation refuses a vault that holds a QSB account", async () => {
    const service = await serviceOverQsbVault();
    await expect(
      service.createLedgerVault({
        accountContractType: "openzeppelin",
        accountIndex: 0,
        networkId: "SN_MAIN",
        publicKeyX: "0x3a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Wallet already exists");
    await expect(
      service.createKeyVault({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "0x6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Wallet already exists");
    expect((await service.readVault(vaultPassphrase)).qsbAccounts).toEqual([qsbAccount]);
  });

  test("an ordinary mutation carries the QSB account through untouched", async () => {
    const service = await serviceOverQsbVault();
    await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic: STARKNET_PHRASE,
      vaultPassphrase,
    });
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts).toHaveLength(1);
    expect(vault.qsbAccounts).toEqual([qsbAccount]);
  });

  test("a Starknet phrase that is a QSB account's dedicated phrase is refused", async () => {
    const service = await serviceOverQsbVault();
    await expect(
      service.createAccount({
        accountContractType: "openzeppelin",
        mnemonic: PHRASE_A,
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid vault");
    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts).toEqual([]);
    expect(vault.mnemonic).toBeNull();
  });
});
