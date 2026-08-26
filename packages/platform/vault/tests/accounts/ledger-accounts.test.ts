/**
 * Ledger account derivation and keyless-account schema checks: a device public
 * key derives the same OZ address HD/imported accounts would, and the vault
 * admits the keyless account only at the current schema.
 */
import { describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CONTRACT,
  argentAccountAddress,
} from "@mc-wallet/starknet/account-contracts";
import { fakeKms } from "@mc-wallet/testkit/fake-kms";
import { deriveLedgerAccount, deriveLedgerAccountRefs } from "@mc-wallet/vault/accounts";
import { isVaultV2, isVaultV8, type Vault } from "@mc-wallet/vault/schema";
import { isAccountRef, isKeylessAccount } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";

// The fake KMS derives address = 0x<publicKeyX-hex><classHash[2..8]>, so a fixed
// public key and the SN_MAIN class hash 0x111111 pin a known counterfactual
// address — the invariant that a Ledger account funds where it will deploy.
const PUBLIC_KEY_X = "0xabc";
const EXPECTED_ADDRESS = "0xabc111111";

describe("deriveLedgerAccount", () => {
  test("derives a keyless Ledger account at a fixed known address", async () => {
    const account = await deriveLedgerAccount(fakeKms(), {
      accountContractType: "openzeppelin",
      accountIndex: 0,
      publicKeyX: PUBLIC_KEY_X,
    });

    expect(account).toEqual({
      accountContractType: "openzeppelin",
      address: EXPECTED_ADDRESS,
      classHash: "0x111111",
      derivation: {
        accountIndex: 0,
        eip2645application: "LedgerW",
        kind: "ledger",
        path: "m/2645'/1195502025'/734980059'/0'/0'/0",
      },
      id: "SN_MAIN:0xabc111111",
      networkId: "SN_MAIN",
      publicKeyX: PUBLIC_KEY_X,
    });
    expect(isAccountRef(account)).toBe(true);
    expect(isKeylessAccount(account)).toBe(true);
  });

  test("stores the exact device path for the chosen index", async () => {
    const account = await deriveLedgerAccount(fakeKms(), {
      accountContractType: "openzeppelin",
      accountIndex: 7,
      networkId: "SN_SEPOLIA",
      publicKeyX: "0x5",
    });
    expect(account.derivation.path).toBe("m/2645'/1195502025'/734980059'/0'/7'/0");
    expect(account.networkId).toBe("SN_SEPOLIA");
    expect(account.address).toBe("0x5abcdef");
  });

  test("preserves Argent contract semantics for a keyless account", async () => {
    const account = await deriveLedgerAccount(fakeKms(), {
      accountContractType: "argent",
      accountIndex: 0,
      publicKeyX: PUBLIC_KEY_X,
    });

    expect(account).toMatchObject({
      accountContractType: "argent",
      address: argentAccountAddress(PUBLIC_KEY_X, PUBLIC_KEY_X),
      deploymentSalt: PUBLIC_KEY_X,
    });
    expect(sameFelt(account.classHash, ARGENT_ACCOUNT_CONTRACT.classHash)).toBe(true);
  });

  test("rejects an invalid index, public key, or network", async () => {
    await expect(
      deriveLedgerAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        accountIndex: -1,
        publicKeyX: PUBLIC_KEY_X,
      }),
    ).rejects.toThrow("Invalid Ledger account index");
    await expect(
      deriveLedgerAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        accountIndex: 0,
        publicKeyX: "0x0",
      }),
    ).rejects.toThrow("Invalid Ledger public key");
    await expect(
      deriveLedgerAccount(fakeKms(), {
        accountContractType: "openzeppelin",
        accountIndex: 0,
        networkId: "NOPE" as never,
        publicKeyX: PUBLIC_KEY_X,
      }),
    ).rejects.toThrow("Invalid Starknet network");
  });
});

describe("deriveLedgerAccountRefs", () => {
  test("derives a batch of enumerated pairs on one network", async () => {
    const refs = await deriveLedgerAccountRefs(fakeKms(), {
      accountContractType: "openzeppelin",
      entries: [
        { accountIndex: 0, publicKeyX: "0xabc" },
        { accountIndex: 1, publicKeyX: "0xde" },
      ],
      networkId: "SN_MAIN",
    });
    expect(refs.map((ref) => ref.derivation.accountIndex)).toEqual([0, 1]);
    expect(refs.map((ref) => ref.address)).toEqual(["0xabc111111", "0xde111111"]);
    expect(refs.every((ref) => ref.derivation.kind === "ledger")).toBe(true);
  });

  test("rejects an invalid network before deriving", async () => {
    await expect(
      deriveLedgerAccountRefs(fakeKms(), {
        accountContractType: "openzeppelin",
        entries: [],
        networkId: "NOPE" as never,
      }),
    ).rejects.toThrow("Invalid Starknet network");
  });
});

describe("keyless account in the vault schema", () => {
  const ledgerAccount = {
    accountContractType: "openzeppelin" as const,
    address: EXPECTED_ADDRESS,
    classHash: "0x111111",
    derivation: {
      accountIndex: 0,
      eip2645application: "LedgerW",
      kind: "ledger" as const,
      path: "m/2645'/1195502025'/734980059'/0'/0'/0",
    },
    id: "SN_MAIN:0xabc111111",
    networkId: "SN_MAIN" as const,
    publicKeyX: PUBLIC_KEY_X,
  };
  const base = {
    accounts: [ledgerAccount],
    accountSecrets: [],
    activeAccountId: ledgerAccount.id,
    mnemonic: null,
    originGrants: [],
    signingKeys: [],
  };

  test("a current vault admits a keyless Ledger account with no signing key", () => {
    const vault: Vault = { ...base, schemaVersion: 8 };
    expect(isVaultV8(vault)).toBe(true);
  });

  test("a Ledger account is rejected at the legacy v2 schema", () => {
    expect(isVaultV2({ ...base, schemaVersion: 2 })).toBe(false);
  });

  test("a Ledger account carrying a signing key is rejected", () => {
    expect(
      isVaultV8({
        ...base,
        schemaVersion: 8,
        signingKeys: [{ accountId: ledgerAccount.id, privateKey: "0x1" }],
      }),
    ).toBe(false);
  });

  test("a non-Ledger account still requires its signing key", () => {
    const hdAccount = {
      accountContractType: "openzeppelin" as const,
      address: "0x1",
      classHash: "0x2",
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
      id: "SN_MAIN:0x1",
      networkId: "SN_MAIN" as const,
      publicKeyX: "0x3",
      publicKeyY: "0x4",
    };
    expect(
      isVaultV8({
        accounts: [hdAccount],
        accountSecrets: [],
        activeAccountId: hdAccount.id,
        mnemonic: null,
        originGrants: [],
        schemaVersion: 8,
        signingKeys: [],
      }),
    ).toBe(false);
  });

  test("a rejected non-canonical Ledger path fails account validation", () => {
    expect(
      isAccountRef({
        ...ledgerAccount,
        derivation: { ...ledgerAccount.derivation, path: "m/44'/0'/0" },
      }),
    ).toBe(false);
  });

  test("rejects Ledger metadata whose path, index, or application disagree", () => {
    expect(
      isAccountRef({
        ...ledgerAccount,
        derivation: { ...ledgerAccount.derivation, accountIndex: 1 },
      }),
    ).toBe(false);
    expect(
      isAccountRef({
        ...ledgerAccount,
        derivation: { ...ledgerAccount.derivation, eip2645application: "Other" },
      }),
    ).toBe(false);
  });
});
