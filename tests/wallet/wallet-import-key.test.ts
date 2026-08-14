/**
 * Raw-private-key import checks: address/public-key derivation goes through
 * Krusty only, invalid keys and duplicates are rejected, and the imported key
 * is routed to the encrypted vault (never plaintext, never echoed).
 */
import { describe, expect, test } from "bun:test";
import { argentAccountAddress } from "@mc-wallet/starknet/account-contracts";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { fakeKms } from "@mc-wallet/testkit/fake-kms";
import { deriveImportedAccount } from "@mc-wallet/vault/accounts";
import { createEncryptedStore } from "@mc-wallet/vault/encrypted-store";
import { createWalletVaultService } from "@mc-wallet/vault/service";
import { isAccountRef } from "@mc-wallet/wallet-model/accounts";
import { ec } from "starknet";
import { readImportAccountInput } from "../../apps/extension/src/background/accounts/import-inputs";

const vaultKey = "mc-wallet:vault";
const migrationKey = "mc-wallet:vault-migration";
const vaultPassphrase = "correct horse battery staple";
// Clearly-fake test vector; not a real key.
const importedKey = "0xfeedface";
const importedInput = {
  accountContractType: "openzeppelin",
  networkId: "SN_MAIN",
  privateKey: importedKey,
} as const;
const serviceImportInput = { ...importedInput, vaultPassphrase };

const importKms = () => ({
  ...fakeKms(),
  async deriveOzAccountAddress(publicKeyX: string, classHash: string) {
    // Deterministic, in-range test address; production address derivation
    // remains owned by Krusty.
    return `0x${publicKeyX.slice(-16)}${classHash.slice(-6)}`;
  },
  async signStarkHash(privateKey: string, messageHash: string) {
    const signature = ec.starkCurve.sign(messageHash, privateKey);
    return {
      publicKey: ec.starkCurve.getStarkKey(privateKey),
      r: `0x${signature.r.toString(16)}`,
      s: `0x${signature.s.toString(16)}`,
    };
  },
});

const newService = () =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), vaultKey),
    kms: importKms(),
    migrationStore: createEncryptedStore(createMemoryStore(), migrationKey),
  });

describe("deriveImportedAccount", () => {
  test("derives the OZ account through Krusty from a raw key", async () => {
    const { account, privateKey } = await deriveImportedAccount(importKms(), importedInput);

    const publicKeyX = ec.starkCurve.getStarkKey(importedKey);
    const address = `0x${publicKeyX.slice(-16)}111111`;
    // publicKeyX comes from a verified Krusty probe signature; the address is
    // then derived the same way HD accounts are (deriveOzAccountAddress).
    expect(account.derivation).toEqual({ kind: "imported-raw-key" });
    expect(account.publicKeyX).toBe(publicKeyX);
    expect(account.address).toBe(address);
    expect(account.id).toBe(`SN_MAIN:${address}`);
    expect(account).not.toHaveProperty("publicKeyY");
    expect(privateKey).toBe(importedKey);
    expect(isAccountRef(account)).toBe(true);
  });

  test("recovers an Argent account at its exact external deployment salt", async () => {
    const deploymentSalt = "0x777";
    const { account } = await deriveImportedAccount(importKms(), {
      accountContractType: "argent",
      deploymentSalt,
      networkId: "SN_MAIN",
      privateKey: importedKey,
    });

    expect(account).toMatchObject({
      accountContractType: "argent",
      address: argentAccountAddress(account.publicKeyX, deploymentSalt),
      deploymentSalt,
    });
    expect(isAccountRef(account)).toBe(true);
  });

  test("rejects a private key at or above the field prime", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        accountContractType: "openzeppelin",
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
        accountContractType: "openzeppelin",
        privateKey: "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f",
      }),
    ).rejects.toThrow("Invalid private key");
  });

  test("rejects a private key inside the [curve order, field prime) gap", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        // curve order + 1: passes the field-prime check but is not a valid key.
        privateKey: "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d30",
      }),
    ).rejects.toThrow("Invalid private key");
  });

  test("accepts a private key just below the curve order", async () => {
    const { account } = await deriveImportedAccount(importKms(), {
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      // curve order - 1: the largest valid signing scalar.
      privateKey: "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2e",
    });
    expect(account.derivation).toEqual({ kind: "imported-raw-key" });
    expect(isAccountRef(account)).toBe(true);
  });

  test("rejects a zero private key", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        privateKey: "0x0",
      }),
    ).rejects.toThrow("Invalid private key");
  });

  // Krusty owns crypto and must fail closed: if the KMS hands back a malformed
  // public key for the probe signature, the import aborts rather than deriving
  // an OZ address from garbage. A valid-looking key still reaches the KMS (the
  // guard is on the KMS *result*, not the input), so this is the fail-closed
  // check on the public-key recovery step unique to raw-key import.
  test("fails closed when Krusty returns an invalid public key", async () => {
    const badKms = {
      ...fakeKms(),
      async signStarkHash() {
        return { publicKey: "0x0", r: "0x1", s: "0x2" };
      },
    };
    await expect(deriveImportedAccount(badKms, importedInput)).rejects.toThrow(
      "Krusty KMS returned invalid public key",
    );
  });

  test("rejects a well-shaped KMS probe that does not verify", async () => {
    const genuine = await importKms().signStarkHash(importedKey, "0x1");
    const badKms = {
      ...fakeKms(),
      async signStarkHash() {
        return { ...genuine, publicKey: ec.starkCurve.getStarkKey("0xdeadbeef") };
      },
    };
    await expect(deriveImportedAccount(badKms, importedInput)).rejects.toThrow(
      "Krusty KMS public-key probe did not verify",
    );
  });
});

describe("vault-service importRawKeyAccount", () => {
  test("routes the imported key to the encrypted vault, not plaintext", async () => {
    const store = createMemoryStore();
    const service = createWalletVaultService({
      encryptedStore: createEncryptedStore(store, vaultKey),
      kms: importKms(),
      migrationStore: createEncryptedStore(store, migrationKey),
    });

    const account = await service.importRawKeyAccount(serviceImportInput);
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
    await service.importRawKeyAccount(serviceImportInput);

    await expect(service.importRawKeyAccount(serviceImportInput)).rejects.toThrow(
      "Account already exists",
    );
  });

  test("rejects an invalid key without adding an account", async () => {
    const service = newService();
    await expect(
      service.importRawKeyAccount({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "0x0",
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid private key");

    await expect(service.status()).resolves.toMatchObject({ hasVault: false });
  });

  // Extending an imported account onto another network goes through the same
  // ensureNetworkAccount path HD accounts use. It must carry the imported
  // provenance across — a raw-key account has no HD position and no publicKeyY,
  // so the derived network account must round-trip as an imported account (not
  // silently become HD-shaped, which isAccountRef would then reject).
  test("extends an imported account onto another network keeping imported provenance", async () => {
    const service = newService();
    const mainnet = await service.importRawKeyAccount(serviceImportInput);

    const sepolia = await service.ensureNetworkAccount({
      networkId: "SN_SEPOLIA",
      vaultPassphrase,
    });

    expect(sepolia.derivation).toEqual({ kind: "imported-raw-key" });
    expect(sepolia).not.toHaveProperty("publicKeyY");
    expect(sepolia.publicKeyX).toBe(mainnet.publicKeyX);
    expect(sepolia.networkId).toBe("SN_SEPOLIA");
    expect(isAccountRef(sepolia)).toBe(true);

    const vault = await service.readVault(vaultPassphrase);
    expect(vault.accounts).toEqual([mainnet, sepolia]);
    // The same imported key backs both network accounts; neither entry leaks it
    // outside signingKeys.
    expect(vault.signingKeys).toEqual([
      { accountId: mainnet.id, privateKey: importedKey },
      { accountId: sepolia.id, privateKey: importedKey },
    ]);
  });
});

describe("readImportAccountInput", () => {
  test("accepts and canonicalizes a valid key", () => {
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "0xFEEDFACE",
        type: "wallet.importAccount",
      }),
    ).toEqual({
      accountContractType: "openzeppelin",
      networkId: "SN_MAIN",
      privateKey: "0xfeedface",
    });
  });

  test("accepts an Argent deployment salt and rejects it for OpenZeppelin", () => {
    expect(
      readImportAccountInput({
        accountContractType: "argent",
        deploymentSalt: " 0x0777 ",
        networkId: "SN_MAIN",
        privateKey: importedKey,
        type: "wallet.importAccount",
      }),
    ).toEqual({
      accountContractType: "argent",
      deploymentSalt: "0x777",
      networkId: "SN_MAIN",
      privateKey: importedKey,
    });
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        deploymentSalt: "0x777",
        networkId: "SN_MAIN",
        privateKey: importedKey,
        type: "wallet.importAccount",
      }),
    ).toBeNull();
  });

  test("rejects malformed or out-of-range messages", () => {
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "NOPE",
        privateKey: importedKey,
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "0x0",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "not-a-felt",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: importedKey,
        type: "wallet.addAccount",
      }),
    ).toBeNull();
  });

  test("accepts a mixed-case 0x-hex key and canonicalizes it to lowercase", () => {
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_SEPOLIA",
        privateKey: "  0xFeEdFaCe  ",
        type: "wallet.importAccount",
      }),
    ).toEqual({
      accountContractType: "openzeppelin",
      networkId: "SN_SEPOLIA",
      privateKey: "0xfeedface",
    });
  });

  // Key material must be read only in the documented 0x-hex form. A base-
  // agnostic parser (BigInt/canonicalFelt) would accept decimal, octal, and
  // binary and silently reinterpret the paste as a different scalar; the parser
  // normalizes with normalizeFeltInput (0x-hex only), so these are all rejected
  // rather than coerced. Matches how every other pasted felt (addresses,
  // calldata) is normalized.
  test("rejects a decimal key rather than coercing it to a different felt", () => {
    // 4276993742 === 0xfeedface: a base-agnostic parser would admit this as the
    // same key; the 0x-hex-only parser must reject the bare decimal spelling.
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "4276993742",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
  });

  test("rejects an octal- or binary-prefixed key", () => {
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "0o377",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "0b1010",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
  });

  test("rejects a hex-shaped key pasted without the 0x prefix", () => {
    // Without 0x the base is ambiguous; refuse rather than guess. "10" would be
    // decimal 10 to BigInt but a user may mean 0x10 — never silently pick one.
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "feedface",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "10",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
  });

  test("rejects a key in the [curve order, field prime) gap at the boundary", () => {
    // curve order + 1: canonicalizes to a felt < field prime, so a field-prime
    // check would wrongly admit it; the curve-order check rejects it here.
    expect(
      readImportAccountInput({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey: "0x0800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d30",
        type: "wallet.importAccount",
      }),
    ).toBeNull();
  });
});
