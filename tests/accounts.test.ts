/**
 * Account derivation checks prove wallet metadata comes from Krusty KMS.
 */
import { describe, expect, test } from "bun:test";
import { deriveAccountRef } from "../src/wallet/accounts";
import { fakeKms } from "./fake-kms";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";

describe("deriveAccountRef", () => {
  test("creates Starknet account metadata without returning private keys", async () => {
    const account = await deriveAccountRef(fakeKms(), { mnemonic });

    expect(account).toEqual({
      address: "0xabcabcdef",
      classHash: "0xabcdef",
      derivation: {
        accountIndex: 0,
        addressIndex: 0,
        kind: "starknet-bip44",
      },
      id: "SN_SEPOLIA:0xabcabcdef",
      networkId: "SN_SEPOLIA",
      publicKeyX: "0xabc",
      publicKeyY: "0xdef",
    });
    expect(JSON.stringify(account)).not.toContain("0x123456");
  });

  test("rejects invalid mnemonics", async () => {
    await expect(deriveAccountRef(fakeKms(false), { mnemonic })).rejects.toThrow(
      "Invalid mnemonic",
    );
  });

  test("rejects unsafe derivation indexes before KMS derivation", async () => {
    await expect(deriveAccountRef(fakeKms(), { accountIndex: -1, mnemonic })).rejects.toThrow(
      "Invalid derivation index",
    );
    await expect(
      deriveAccountRef(fakeKms(), { addressIndex: Number.MAX_SAFE_INTEGER + 1, mnemonic }),
    ).rejects.toThrow("Invalid derivation index");
  });

  test("rejects invalid class hashes before storing account metadata", async () => {
    await expect(
      deriveAccountRef(fakeKms(), {
        classHash: "not-hex",
        mnemonic,
      }),
    ).rejects.toThrow("Invalid account class hash");
    await expect(
      deriveAccountRef(fakeKms(), {
        classHash: "0x800000000000011000000000000000000000000000000000000000000000001",
        mnemonic,
      }),
    ).rejects.toThrow("Invalid account class hash");
    await expect(
      deriveAccountRef(fakeKms(), {
        classHash: "0x0",
        mnemonic,
      }),
    ).rejects.toThrow("Invalid account class hash");
    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async getAccountClassHashes() {
            return JSON.stringify({ oz: { "3.0.0": { SN_SEPOLIA: "not-hex" } } });
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned an invalid class hash");
    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async getAccountClassHashes() {
            return JSON.stringify({ oz: { "3.0.0": { SN_SEPOLIA: "0x0" } } });
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned an invalid class hash");
  });

  test("rejects invalid KMS account outputs", async () => {
    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async deriveStarknetKeypair() {
            return {
              privateKey: "not-hex",
              publicKeyX: "0xabc",
              publicKeyY: "0xdef",
            };
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned invalid account key material");
    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async deriveStarknetKeypair() {
            return {
              privateKey: "0x0",
              publicKeyX: "0xabc",
              publicKeyY: "0xdef",
            };
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned invalid account key material");
    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async deriveStarknetKeypair() {
            return {
              privateKey: "0x800000000000011000000000000000000000000000000000000000000000001",
              publicKeyX: "0xabc",
              publicKeyY: "0xdef",
            };
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned invalid account key material");
    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async deriveStarknetKeypair() {
            return {
              privateKey: "0x123",
              publicKeyX: "0x0",
              publicKeyY: "0xdef",
            };
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned invalid account key material");
    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async deriveOzAccountAddress() {
            return "not-hex";
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned invalid account address");
    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async deriveOzAccountAddress() {
            return "0x0";
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned invalid account address");
  });

  test("rejects invalid public keys before deriving addresses", async () => {
    let addressDerived = false;

    await expect(
      deriveAccountRef(
        {
          ...fakeKms(),
          async deriveOzAccountAddress() {
            addressDerived = true;
            return "0xabc";
          },
          async deriveStarknetKeypair() {
            return {
              privateKey: "0x123",
              publicKeyX: "not-hex",
              publicKeyY: "0xdef",
            };
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned invalid account key material");
    expect(addressDerived).toBe(false);
  });
});
