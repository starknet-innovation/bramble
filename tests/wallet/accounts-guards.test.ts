/**
 * Guard/error branches in account derivation not covered by tests/wallet/accounts.test.ts:
 * the class-hash JSON parse failure and the missing-`oz` shape in
 * getOzAccountClassHash (reached through deriveAccountRef when no explicit class
 * hash is supplied), plus deriveImportedAccount's invalid-network and
 * invalid-class-hash rejections. Mirrors the fake-KMS style of
 * tests/wallet/accounts.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { KrustyKms } from "../../src/crypto/krusty";
import { deriveAccountRef, deriveImportedAccount } from "../../src/wallet/accounts";
import { fakeKms } from "../support/fake-kms";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
// A valid, non-zero, in-range stark private key felt.
const PRIVATE_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const withClassHashes = (getAccountClassHashes: () => Promise<string>): KrustyKms => ({
  ...fakeKms(),
  getAccountClassHashes,
});

describe("getOzAccountClassHash via deriveAccountRef", () => {
  test("throws when Krusty returns invalid class-hash JSON", async () => {
    const kms = withClassHashes(async () => "{not json");
    await expect(deriveAccountRef(kms, { mnemonic })).rejects.toThrow(
      "Krusty KMS returned invalid class hash JSON",
    );
  });

  test("throws when the class-hash map has no oz accounts", async () => {
    const kms = withClassHashes(async () => JSON.stringify({ argent: {} }));
    await expect(deriveAccountRef(kms, { mnemonic })).rejects.toThrow(
      "Krusty KMS class hashes are missing oz accounts",
    );
  });

  test("throws when the oz map lacks the requested network", async () => {
    const kms = withClassHashes(async () =>
      JSON.stringify({ oz: { "3.0.0": { SN_SEPOLIA: "0x111" } } }),
    );
    await expect(deriveAccountRef(kms, { mnemonic })).rejects.toThrow(
      "Krusty KMS class hashes are missing SN_MAIN",
    );
  });
});

describe("deriveImportedAccount", () => {
  test("rejects an invalid Starknet network before any KMS derivation", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        classHash: "0xabcdef",
        networkId: "SN_BAD" as never,
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow("Invalid Starknet network");
  });

  test("rejects an invalid explicit class hash", async () => {
    await expect(
      deriveImportedAccount(fakeKms(), {
        classHash: "not-hex",
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow("Invalid account class hash");
    await expect(
      deriveImportedAccount(fakeKms(), {
        classHash: "0x0",
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow("Invalid account class hash");
  });

  test("rejects an invalid private key up front", async () => {
    await expect(deriveImportedAccount(fakeKms(), { privateKey: "0x0" })).rejects.toThrow(
      "Invalid private key",
    );
  });
});
