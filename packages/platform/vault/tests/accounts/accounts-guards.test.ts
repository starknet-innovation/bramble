/**
 * Guard/error branches in account derivation not covered by tests/wallet/accounts.test.ts:
 * the class-hash JSON parse failure and the missing-`oz` shape in
 * getOzAccountClassHash (reached through deriveAccountRef when no explicit class
 * hash is supplied), plus deriveImportedAccount's invalid-network and
 * invalid-class-hash rejections. Mirrors the fake-KMS style of
 * tests/wallet/accounts.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { deriveAccountRef, deriveImportedAccount } from "@bramble/vault/accounts";
import type { KmsPort } from "@bramble/vault/kms-port";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
// A valid, non-zero, in-range stark private key felt.
const PRIVATE_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const withClassHashes = (getAccountClassHashes: () => Promise<string>): KmsPort => ({
  ...fakeKms(),
  getAccountClassHashes,
});

describe("getOzAccountClassHash via deriveAccountRef", () => {
  test("throws when Krusty returns invalid class-hash JSON", async () => {
    const kms = withClassHashes(async () => "{not json");
    await expect(
      deriveAccountRef(kms, { accountContractType: "openzeppelin", mnemonic }),
    ).rejects.toThrow("Krusty KMS returned invalid class hash JSON");
  });

  test("throws when the class-hash map has no oz accounts", async () => {
    const kms = withClassHashes(async () => JSON.stringify({ argent: {} }));
    await expect(
      deriveAccountRef(kms, { accountContractType: "openzeppelin", mnemonic }),
    ).rejects.toThrow("Krusty KMS class hashes are missing oz accounts");
  });

  test("throws when the oz map lacks the requested network", async () => {
    const kms = withClassHashes(async () =>
      JSON.stringify({ oz: { "3.0.0": { SN_SEPOLIA: "0x111" } } }),
    );
    await expect(
      deriveAccountRef(kms, { accountContractType: "openzeppelin", mnemonic }),
    ).rejects.toThrow("Krusty KMS class hashes are missing SN_MAIN");
  });

  // Devnet resolves to the class its node predeclares and never consults
  // Krusty's map, so an empty map must still yield it.
  test("resolves devnet to the class the devnet node predeclares", async () => {
    const kms = withClassHashes(async () => JSON.stringify({ oz: { "3.0.0": {} } }));
    const account = await deriveAccountRef(kms, {
      accountContractType: "openzeppelin",
      mnemonic,
      networkId: "SN_DEVNET",
    });
    expect(account.classHash).toBe(
      "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
    );
  });
});

describe("deriveImportedAccount", () => {
  test("rejects an invalid Starknet network before any KMS derivation", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        classHash: "0xabcdef",
        networkId: "SN_BAD" as never,
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow("Invalid Starknet network");
  });

  test("rejects an invalid explicit class hash", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        classHash: "not-hex",
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow("Invalid account class hash");
    await expect(
      deriveImportedAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        classHash: "0x0",
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow("Invalid account class hash");
  });

  test("rejects an invalid private key up front", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        privateKey: "0x0",
      }),
    ).rejects.toThrow("Invalid private key");
  });
});
