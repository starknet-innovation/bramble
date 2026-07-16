/**
 * Raw-private-key import checks: address/public-key derivation goes through
 * Krusty only, invalid keys and duplicates are rejected, and the imported key
 * is routed to the encrypted vault (never plaintext, never echoed).
 */
import { describe, expect, test } from "bun:test";
import { readImportAccountInput } from "../src/background/import-inputs";
import { createEncryptedStore } from "../src/storage/encrypted-store";
import { createMemoryStore } from "../src/storage/kv";
import type { AccountRef } from "../src/storage/vault-schema";
import { isAccountRef } from "../src/storage/vault-schema";
import { deriveImportedAccount, nextAccountIndex, sameWalletKey } from "../src/wallet/accounts";
import { createWalletVaultService } from "../src/wallet/vault-service";
import { fakeKms } from "./fake-kms";

const vaultKey = "mc-wallet:vault";
const vaultPassphrase = "correct horse battery staple";
// Clearly-fake test vector; not a real key.
const importedKey = "0xfeedface";

const newService = () =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
    kms: fakeKms(),
  });

describe("deriveImportedAccount", () => {
  test("derives the OZ account through Krusty from a raw key", async () => {
    const { account, privateKey } = await deriveImportedAccount(fakeKms(), {
      networkId: "SN_MAIN",
      privateKey: importedKey,
    });

    // publicKeyX comes from the Krusty signature's public key; the address is
    // derived the same way HD accounts are (deriveOzAccountAddress).
    expect(account.derivation).toEqual({ kind: "imported-raw-key" });
    expect(account.publicKeyX).toBe("0xabc");
    expect(account.address).toBe("0xabc111111");
    expect(account.id).toBe("SN_MAIN:0xabc111111");
    expect(account).not.toHaveProperty("publicKeyY");
    expect(privateKey).toBe(importedKey);
    expect(isAccountRef(account)).toBe(true);
  });

  test("rejects a private key at or above the field prime", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        privateKey: "0x800000000000011000000000000000000000000000000000000000000000001",
      }),
    ).rejects.toThrow("Invalid private key");
  });

  // A valid Stark signing scalar must be < the curve order n, not merely < the
  // field prime P. The gap [n, P) holds field elements that are NOT valid keys;
  // a signer would reduce them mod n and derive an account for a different
  // effective scalar. These lock the range check to the curve order.
  test("rejects a private key equal to the curve order", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        privateKey: "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f",
      }),
    ).rejects.toThrow("Invalid private key");
  });

  test("rejects a private key inside the [curve order, field prime) gap", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        // curve order + 1: passes the field-prime check but is not a valid key.
        privateKey: "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d30",
      }),
    ).rejects.toThrow("Invalid private key");
  });

  test("accepts a private key just below the curve order", async () => {
    const { account } = await deriveImportedAccount(fakeKms(), {
      networkId: "SN_MAIN",
      // curve order - 1: the largest valid signing scalar.
      privateKey: "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2e",
    });
    expect(account.derivation).toEqual({ kind: "imported-raw-key" });
    expect(isAccountRef(account)).toBe(true);
  });

  test("rejects a zero private key", async () => {
    await expect(deriveImportedAccount(fakeKms(), { privateKey: "0x0" })).rejects.toThrow(
      "Invalid private key",
    );
  });
});

describe("vault-service importRawKeyAccount", () => {
  test("routes the imported key to the encrypted vault, not plaintext", async () => {
    const store = createMemoryStore();
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(store, vaultKey),
      kms: fakeKms(),
    });

    const account = await service.importRawKeyAccount({
      networkId: "SN_MAIN",
      privateKey: importedKey,
      vaultPassphrase,
    });
    const raw = JSON.stringify(await store.get(vaultKey));
    const vault = await service.readVault(vaultPassphrase);

    // The response never carries the key; the ciphertext never holds it in the
    // clear; the vault's signingKeys is the only home for it.
    expect(account).not.toHaveProperty("privateKey");
    expect(raw).not.toContain(importedKey);
    expect(vault.signingKeys).toEqual([{ accountId: account.id, privateKey: importedKey }]);
    expect(vault.accounts).toEqual([account]);
    expect(vault.activeAccountId).toBe(account.id);
    expect(account.derivation.kind).toBe("imported-raw-key");
  });

  test("rejects a duplicate imported account", async () => {
    const service = newService();
    await service.importRawKeyAccount({
      networkId: "SN_MAIN",
      privateKey: importedKey,
      vaultPassphrase,
    });

    await expect(
      service.importRawKeyAccount({
        networkId: "SN_MAIN",
        privateKey: importedKey,
        vaultPassphrase,
      }),
    ).rejects.toThrow("Account already exists");
  });

  test("rejects an invalid key without adding an account", async () => {
    const service = newService();
    await expect(
      service.importRawKeyAccount({ networkId: "SN_MAIN", privateKey: "0x0", vaultPassphrase }),
    ).rejects.toThrow("Invalid private key");

    await expect(service.status()).resolves.toMatchObject({ hasVault: false });
  });
});

describe("readImportAccountInput", () => {
  test("accepts and canonicalizes a valid key", () => {
    expect(
      readImportAccountInput({
        networkId: "SN_MAIN",
        privateKey: "0xFEEDFACE",
        type: "wallet.importAccount",
      }),
    ).toEqual({ networkId: "SN_MAIN", privateKey: "0xfeedface" });
  });

  test("rejects malformed or out-of-range messages", () => {
    expect(
      readImportAccountInput({ networkId: "SN_MAIN", type: "wallet.importAccount" }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        networkId: "NOPE",
        privateKey: importedKey,
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        networkId: "SN_MAIN",
        privateKey: "0x0",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        networkId: "SN_MAIN",
        privateKey: "not-a-felt",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        networkId: "SN_MAIN",
        privateKey: importedKey,
        type: "wallet.addAccount",
      }),
    ).toBeNull();
  });

  test("rejects a key in the [curve order, field prime) gap at the boundary", () => {
    // curve order + 1: canonicalizes to a felt < field prime, so a field-prime
    // check would wrongly admit it; the curve-order check rejects it here.
    expect(
      readImportAccountInput({
        networkId: "SN_MAIN",
        privateKey: "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d30",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
  });
});

describe("isAccountRef imported round-trip", () => {
  const imported = {
    address: "0xabc111111",
    classHash: "0x111111",
    derivation: { kind: "imported-raw-key" },
    id: "SN_MAIN:0xabc111111",
    networkId: "SN_MAIN",
    publicKeyX: "0xabc",
  };

  test("accepts an imported account without publicKeyY", () => {
    expect(isAccountRef(imported)).toBe(true);
  });

  test("rejects an imported account carrying publicKeyY", () => {
    expect(isAccountRef({ ...imported, publicKeyY: "0xdef" })).toBe(false);
  });

  test("rejects an imported account carrying HD indices", () => {
    expect(
      isAccountRef({
        ...imported,
        derivation: { accountIndex: 0, addressIndex: 0, kind: "imported-raw-key" },
      }),
    ).toBe(false);
  });

  test("still requires publicKeyY on a derived account", () => {
    expect(
      isAccountRef({
        address: "0xabc111111",
        classHash: "0x111111",
        derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
        id: "SN_MAIN:0xabc111111",
        networkId: "SN_MAIN",
        publicKeyX: "0xabc",
      }),
    ).toBe(false);
  });
});

const bip44Account = (
  publicKeyX: string,
  accountIndex: number,
  addressIndex = 0,
  networkId: "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN",
): AccountRef => ({
  address: `0x${publicKeyX.slice(2)}a`,
  classHash: "0x111111",
  derivation: { accountIndex, addressIndex, kind: "starknet-bip44" },
  id: `${networkId}:0x${publicKeyX.slice(2)}a`,
  networkId,
  publicKeyX,
  publicKeyY: "0xdef",
});

const importedAccount = (
  publicKeyX: string,
  networkId: "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN",
): AccountRef => ({
  address: `0x${publicKeyX.slice(2)}b`,
  classHash: "0x111111",
  derivation: { kind: "imported-raw-key" },
  id: `${networkId}:0x${publicKeyX.slice(2)}b`,
  networkId,
  publicKeyX,
});

describe("sameWalletKey", () => {
  test("matches HD accounts only on the same key and derivation position", () => {
    expect(sameWalletKey(bip44Account("0xabc", 0), bip44Account("0xabc", 0))).toBe(true);
    // Same key, different account index -> a distinct HD account.
    expect(sameWalletKey(bip44Account("0xabc", 0), bip44Account("0xabc", 1))).toBe(false);
    // Same key and account index, different address index -> still distinct.
    expect(sameWalletKey(bip44Account("0xabc", 0, 0), bip44Account("0xabc", 0, 1))).toBe(false);
    // Different key.
    expect(sameWalletKey(bip44Account("0xabc", 0), bip44Account("0xdef", 0))).toBe(false);
  });

  test("matches imported accounts on the public key alone (no HD position)", () => {
    expect(sameWalletKey(importedAccount("0xabc"), importedAccount("0xabc"))).toBe(true);
    expect(sameWalletKey(importedAccount("0xabc"), importedAccount("0xdef"))).toBe(false);
  });

  test("never conflates an imported account with an HD account of the same key", () => {
    expect(sameWalletKey(bip44Account("0xabc", 0), importedAccount("0xabc"))).toBe(false);
    expect(sameWalletKey(importedAccount("0xabc"), bip44Account("0xabc", 0))).toBe(false);
  });
});

describe("nextAccountIndex", () => {
  test("returns the lowest unused HD index, skipping imported accounts", () => {
    const accounts = [
      bip44Account("0xa", 0),
      bip44Account("0xb", 2),
      // An imported account holds no HD position and must not occupy an index.
      importedAccount("0xc"),
    ];
    expect(nextAccountIndex(accounts, "SN_MAIN")).toBe(1);
  });

  test("counts only the target network's HD accounts", () => {
    const accounts = [
      bip44Account("0xa", 0, 0, "SN_MAIN"),
      bip44Account("0xb", 1, 0, "SN_SEPOLIA"),
    ];
    // Sepolia's index 1 must not push the mainnet next index past 1.
    expect(nextAccountIndex(accounts, "SN_MAIN")).toBe(1);
    expect(nextAccountIndex([], "SN_MAIN")).toBe(0);
  });
});
