/**
 * Account derivation checks prove wallet metadata comes from Krusty KMS.
 */
import { describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CONTRACT,
  argentAccountAddress,
} from "@mc-wallet/starknet/account-contracts";
import { fakeKms } from "@mc-wallet/testkit/fake-kms";
import { deriveAccountRef } from "@mc-wallet/vault/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";

describe("deriveAccountRef", () => {
  test("creates Starknet account metadata without returning private keys", async () => {
    const account = await deriveAccountRef(fakeKms(), {
      accountContractType: "openzeppelin",
      mnemonic,
    });

    expect(account).toEqual({
      accountContractType: "openzeppelin",
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

  test("derives Argent accounts from the pinned class and constructor", async () => {
    let ozAddressDerived = false;
    const account = await deriveAccountRef(
      {
        ...fakeKms(),
        async deriveOzAccountAddress() {
          ozAddressDerived = true;
          throw new Error("OpenZeppelin derivation must not run");
        },
      },
      { accountContractType: "argent", mnemonic },
    );

    expect(account).toMatchObject({
      accountContractType: "argent",
      address: argentAccountAddress("0xabc", "0xabc"),
    });
    expect(sameFelt(account.classHash, ARGENT_ACCOUNT_CONTRACT.classHash)).toBe(true);
    expect(ozAddressDerived).toBe(false);
  });

  test("rejects a non-pinned class hash for an Argent account", async () => {
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "argent",
        classHash: "0x123",
        mnemonic,
      }),
    ).rejects.toThrow("Invalid Argent account class hash");
  });

  test("rejects invalid mnemonics", async () => {
    await expect(
      deriveAccountRef(fakeKms(false), { accountContractType: "openzeppelin", mnemonic }),
    ).rejects.toThrow("Invalid mnemonic");
  });

  test("rejects unsafe derivation indexes before KMS derivation", async () => {
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "openzeppelin",
        accountIndex: -1,
        mnemonic,
      }),
    ).rejects.toThrow("Invalid derivation index");
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "openzeppelin",
        addressIndex: Number.MAX_SAFE_INTEGER + 1,
        mnemonic,
      }),
    ).rejects.toThrow("Invalid derivation index");
  });

  test("rejects invalid networks even with explicit class hashes", async () => {
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "openzeppelin",
        classHash: "0xabcdef",
        mnemonic,
        networkId: "toString" as never,
      }),
    ).rejects.toThrow("Invalid Starknet network");
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "openzeppelin",
        classHash: "0xabcdef",
        mnemonic,
        networkId: "SN_BAD" as never,
      }),
    ).rejects.toThrow("Invalid Starknet network");
  });

  test("rejects invalid class hashes before storing account metadata", async () => {
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "openzeppelin",
        classHash: "not-hex",
        mnemonic,
      }),
    ).rejects.toThrow("Invalid account class hash");
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "openzeppelin",
        classHash: "0x800000000000011000000000000000000000000000000000000000000000001",
        mnemonic,
      }),
    ).rejects.toThrow("Invalid account class hash");
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "openzeppelin",
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
        { accountContractType: "openzeppelin", mnemonic },
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
        { accountContractType: "openzeppelin", mnemonic },
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
          { accountContractType: "openzeppelin", mnemonic },
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
        { accountContractType: "openzeppelin", mnemonic },
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
        { accountContractType: "openzeppelin", mnemonic },
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
        { accountContractType: "openzeppelin", mnemonic },
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
        { accountContractType: "openzeppelin", mnemonic },
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
        { accountContractType: "openzeppelin", mnemonic },
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
        { accountContractType: "openzeppelin", mnemonic },
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
        { accountContractType: "openzeppelin", mnemonic },
      ),
    ).rejects.toThrow("Krusty KMS returned invalid account key material");
    expect(addressDerived).toBe(false);
  });
});
