/**
 * Account derivation checks prove wallet metadata comes from Krusty KMS.
 */
import { describe, expect, test } from "bun:test";
import { deriveAccountRef } from "../../src/wallet/accounts";
import { fakeKms } from "../support/fake-kms";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";

describe("deriveAccountRef", () => {
  test("creates Starknet account metadata without returning private keys", async () => {
    const account = await deriveAccountRef(fakeKms(), { mnemonic });

    expect(account).toEqual({
      address: "0xabc111111",
      classHash: "0x111111",
      derivation: {
        accountIndex: 0,
        addressIndex: 0,
        kind: "starknet-bip44",
      },
      id: "SN_MAIN:0xabc111111",
      networkId: "SN_MAIN",
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

  test("rejects invalid networks even with explicit class hashes", async () => {
    await expect(
      deriveAccountRef(fakeKms(), {
        classHash: "0xabcdef",
        mnemonic,
        networkId: "toString" as never,
      }),
    ).rejects.toThrow("Invalid Starknet network");
    await expect(
      deriveAccountRef(fakeKms(), {
        classHash: "0xabcdef",
        mnemonic,
        networkId: "SN_BAD" as never,
      }),
    ).rejects.toThrow("Invalid Starknet network");
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
            return JSON.stringify({ oz: { "3.0.0": { SN_MAIN: "not-hex" } } });
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
            return JSON.stringify({ oz: { "3.0.0": { SN_MAIN: "0x0" } } });
          },
        },
        { mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned an invalid class hash");
  });

  test("rejects inherited Krusty class hash fields", async () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "SN_MAIN");
    Object.defineProperty(Object.prototype, "SN_MAIN", {
      configurable: true,
      enumerable: true,
      value: "0xabcdef",
    });

    try {
      await expect(
        deriveAccountRef(
          {
            ...fakeKms(),
            async getAccountClassHashes() {
              return JSON.stringify({ oz: { "3.0.0": {} } });
            },
          },
          { mnemonic },
        ),
      ).rejects.toThrow("Krusty KMS class hashes are missing SN_MAIN");
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(Object.prototype, "SN_MAIN", previousDescriptor);
      } else {
        Reflect.deleteProperty(Object.prototype, "SN_MAIN");
      }
    }
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
