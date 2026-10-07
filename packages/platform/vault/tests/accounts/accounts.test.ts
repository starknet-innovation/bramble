/**
 * Account derivation checks prove wallet metadata comes from Krusty KMS.
 */
import { describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CONTRACT,
  argentAccountAddress,
  familyAccountAddress,
} from "@bramble/starknet/account-contracts";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { deriveAccountRef } from "@bramble/vault/accounts";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import { sameFelt } from "@bramble/wallet-model/networks";

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

  test("keeps the established zero-salt OpenZeppelin address policy explicit", async () => {
    let salt: string | undefined;
    await deriveAccountRef(
      {
        ...fakeKms(),
        async deriveOzAccountAddress(_publicKeyX, _classHash, inputSalt) {
          salt = inputSalt;
          return "0xabc111111";
        },
      },
      { accountContractType: "openzeppelin", mnemonic },
    );

    expect(salt).toBe("0x0");
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
      deploymentSalt: "0xabc",
    });
    expect(sameFelt(account.classHash, ARGENT_ACCOUNT_CONTRACT.classHash)).toBe(true);
    expect(ozAddressDerived).toBe(false);
  });

  test("derives an existing Argent account from its exact deployment salt", async () => {
    const account = await deriveAccountRef(fakeKms(), {
      accountContractType: "argent",
      deploymentSalt: "0x777",
      mnemonic,
    });

    expect(account).toMatchObject({
      accountContractType: "argent",
      address: argentAccountAddress("0xabc", "0x777"),
      deploymentSalt: "0x777",
    });
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

  test("derives an Argent account at any release it could have been deployed with", async () => {
    // A Ready account deployed at 0.3.x keeps that address forever, whatever it
    // upgrades to afterwards. Deriving only at the class this wallet creates is
    // why such an account could never be found.
    const entry = deploymentClasses("argent").find(
      (candidate) => candidate.label === "argent 0.3.0",
    );
    if (!entry) {
      throw new Error("argent 0.3.0 missing from the class table");
    }
    const account = await deriveAccountRef(fakeKms(), {
      accountContractType: "argent",
      classHash: entry.classHash,
      mnemonic,
      networkId: "SN_MAIN",
    });

    expect(sameFelt(account.classHash, entry.classHash)).toBe(true);
    expect(sameFelt(account.address, familyAccountAddress(entry, account.publicKeyX))).toBe(true);
    // The class alone does not determine the address: 0.3.x and 0.4.0 use
    // different constructor calldata, so the same key lands elsewhere. Deriving
    // with the wrong shape is the mistake this asserts against.
    expect(sameFelt(account.address, argentAccountAddress(account.publicKeyX))).toBe(false);
  });
});

describe("vendor-ladder derivation (issue 505)", () => {
  test("derives a Ready-scheme Argent account through Krusty's legacy export", async () => {
    const account = await deriveAccountRef(fakeKms(), {
      accountContractType: "argent",
      accountIndex: 3,
      derivation: "argentx-bip44",
      mnemonic,
    });
    expect(account.derivation).toEqual({ addressIndex: 3, kind: "argentx-bip44" });
    // fakeKms' legacy keys are distinct from its plain ladder on purpose.
    expect(account.publicKeyX).toBe("0xa93bc");
    expect("publicKeyY" in account).toBe(false);
    expect(account.accountContractType).toBe("argent");
  });

  test("refuses the Ready scheme off Argent and under a passphrase", async () => {
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "openzeppelin",
        accountIndex: 0,
        derivation: "argentx-bip44",
        mnemonic,
      }),
    ).rejects.toThrow("Ready derivation is only valid for Argent accounts");
    await expect(
      deriveAccountRef(fakeKms(), {
        accountContractType: "argent",
        accountIndex: 0,
        derivation: "argentx-bip44",
        mnemonic,
        mnemonicPassphrase: "extra word",
      }),
    ).rejects.toThrow("Ready derivation does not take a passphrase");
  });

  test("walks the address axis for Braavos and records the real coordinate", async () => {
    const braavosClass = deploymentClasses("braavos")[0];
    if (!braavosClass) throw new Error("no braavos deployment class");
    const account = await deriveAccountRef(fakeKms(), {
      accountContractType: "braavos",
      accountIndex: 2,
      classHash: braavosClass.classHash,
      mnemonic,
    });
    expect(account.derivation).toEqual({
      accountIndex: 0,
      addressIndex: 2,
      kind: "starknet-bip44",
    });
  });
});
