/**
 * Krusty KMS adapter defensive branches not exercised by the main suite: the
 * non-object module throw, the successful generateMnemonic and
 * getAccountClassHashes happy paths plus their "returned invalid X" throws, and
 * validateMnemonic returning a real boolean vs a non-boolean WASM result.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@mc-wallet/kms-krusty/adapter";

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";

const createModule = (overrides: Record<string, unknown> = {}) => ({
  deriveNostrPublicKey() {
    return { public_key: "11".repeat(32) };
  },
  deriveOzAccountAddress() {
    return "0xabc";
  },
  deriveScopedStrk20ViewingKey() {
    return "0x456";
  },
  deriveStarknetKeypair() {
    return { private_key: "0x123", public_key_x: "0xabc", public_key_y: "0xdef" };
  },
  generateMnemonic() {
    return MNEMONIC;
  },
  getAccountClassHashes() {
    return "{}";
  },
  openNostrApplicationData() {
    return JSON.stringify({
      content: "payload",
      identifier: "mc-wallet.multisig",
      senderPublicKey: "22".repeat(32),
    });
  },
  signStarkHash() {
    return { publicKey: "0xabc", r: "0x1", s: "0x2" };
  },
  validateMnemonic() {
    return true;
  },
  wrapNostrApplicationData() {
    return JSON.stringify({
      content: "ciphertext",
      created_at: 1,
      id: "11".repeat(32),
      kind: 1_059,
      pubkey: "22".repeat(32),
      sig: "33".repeat(64),
      tags: [["p", "44".repeat(32)]],
    });
  },
  ...overrides,
});

describe("createKrustyKms module boundary", () => {
  test("throws when the WASM module is not an object", () => {
    expect(() => createKrustyKms(42)).toThrow("Krusty KMS module did not load as an object");
    expect(() => createKrustyKms(null)).toThrow("Krusty KMS module did not load as an object");
  });
});

describe("generateMnemonic output validation", () => {
  test("returns a valid generated mnemonic", async () => {
    await expect(createKrustyKms(createModule()).generateMnemonic()).resolves.toBe(MNEMONIC);
  });

  test("supports an explicit supported word count", async () => {
    await expect(createKrustyKms(createModule()).generateMnemonic(24)).resolves.toBe(MNEMONIC);
  });

  test("throws when the WASM mnemonic is blank", async () => {
    await expect(
      createKrustyKms(createModule({ generateMnemonic: () => "   " })).generateMnemonic(),
    ).rejects.toThrow("Krusty KMS returned an invalid mnemonic");
  });
});

describe("getAccountClassHashes output validation", () => {
  test("returns the raw class-hash JSON string", async () => {
    const hashes = JSON.stringify({ oz: {} });
    await expect(
      createKrustyKms(
        createModule({ getAccountClassHashes: () => hashes }),
      ).getAccountClassHashes(),
    ).resolves.toBe(hashes);
  });

  test("throws when the WASM result is not a string", async () => {
    await expect(
      createKrustyKms(createModule({ getAccountClassHashes: () => ({}) })).getAccountClassHashes(),
    ).rejects.toThrow("Krusty KMS returned invalid class hashes");
  });
});

describe("validateMnemonic output validation", () => {
  test("returns the WASM boolean verdict for a non-blank mnemonic", async () => {
    await expect(createKrustyKms(createModule()).validateMnemonic(MNEMONIC)).resolves.toBe(true);
    await expect(
      createKrustyKms(createModule({ validateMnemonic: () => false })).validateMnemonic(MNEMONIC),
    ).resolves.toBe(false);
  });

  test("throws when the WASM validation result is not a boolean", async () => {
    await expect(
      createKrustyKms(createModule({ validateMnemonic: () => "yes" })).validateMnemonic(MNEMONIC),
    ).rejects.toThrow("Krusty KMS returned an invalid mnemonic validation result");
  });
});


// Pins the export name this adapter binds: upstream kept `deriveStrk20ViewingKey`
// for a derivation that ignores the chain and pool, so binding to that name would
// return a wrong-scope key with no error anywhere. wasm-bindgen drops surplus
// arguments instead of throwing, so nothing at the call site would show it.
describe("the module surface this adapter is pinned to", () => {
  test("the viewing key is read from the scoped export, never the unscoped one", () => {
    const { deriveScopedStrk20ViewingKey: _scoped, ...unscopedOnly } = createModule();
    expect(() =>
      createKrustyKms({ ...unscopedOnly, deriveStrk20ViewingKey: () => "0x456" }),
    ).toThrow("Krusty KMS export missing: deriveScopedStrk20ViewingKey");
  });
});
