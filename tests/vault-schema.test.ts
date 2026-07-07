/**
 * Vault schema checks reject ambiguous decrypted wallet state.
 */
import { describe, expect, test } from "bun:test";
import {
  CURRENT_SCHEMA_VERSION,
  emptyVault,
  isAccountId,
  isVaultV1,
} from "../src/storage/vault-schema";

const account = {
  address: "0x123",
  classHash: "0xabc",
  derivation: {
    accountIndex: 0,
    addressIndex: 0,
    kind: "starknet-bip44" as const,
  },
  id: "SN_SEPOLIA:0x123",
  networkId: "SN_SEPOLIA",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

const vault = {
  accounts: [account],
  activeAccountId: account.id,
  originGrants: [{ accountIds: [account.id], origin: "https://example.com" }],
  schemaVersion: 1 as const,
  signingKeys: [{ accountId: account.id, privateKey: "0x456" }],
};

describe("isVaultV1", () => {
  test("creates empty vaults with the current schema version", () => {
    expect(emptyVault().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  test("accepts valid current vaults", () => {
    expect(isVaultV1(vault)).toBe(true);
  });

  test("validates account id format", () => {
    expect(isAccountId(account.id)).toBe(true);
    expect(isAccountId("not-an-account")).toBe(false);
    expect(isAccountId("SN_SEPOLIA:not-hex")).toBe(false);
    expect(isAccountId("SN_SEPOLIA:0xABC")).toBe(false);
    expect(isAccountId("SN_SEPOLIA:0x0")).toBe(false);
    expect(isAccountId("toString:0x123")).toBe(false);
  });

  test("rejects extra fields in current vault records", () => {
    const hiddenLabel = { ...vault };
    Object.defineProperty(hiddenLabel, "label", { value: "unexpected" });

    expect(isVaultV1({ ...vault, label: "unexpected" })).toBe(false);
    expect(isVaultV1(hiddenLabel)).toBe(false);
    expect(isVaultV1({ ...vault, accounts: [{ ...account, privateKey: "0x456" }] })).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        accounts: [{ ...account, derivation: { ...account.derivation, path: "m/44" } }],
      }),
    ).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        originGrants: [
          { accountIds: [account.id], label: "unexpected", origin: "https://example.com" },
        ],
      }),
    ).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        signingKeys: [{ accountId: account.id, privateKey: "0x456", publicKey: "0x123" }],
      }),
    ).toBe(false);
  });

  test("rejects duplicate account ids", () => {
    expect(isVaultV1({ ...vault, accounts: [account, { ...account, address: "0x456" }] })).toBe(
      false,
    );
  });

  test("rejects sparse vault arrays", () => {
    const sparseAccounts = new Array<unknown>(1);

    expect(isVaultV1({ ...vault, accounts: sparseAccounts })).toBe(false);
  });

  test("rejects account records with mismatched network identities", () => {
    expect(isVaultV1({ ...vault, accounts: [{ ...account, id: "SN_MAIN:0x123" }] })).toBe(false);
    expect(isVaultV1({ ...vault, accounts: [{ ...account, networkId: "UNKNOWN" }] })).toBe(false);
    expect(isVaultV1({ ...vault, activeAccountId: "not-an-account" })).toBe(false);
    expect(isVaultV1({ ...vault, activeAccountId: null })).toBe(false);
  });

  test("rejects malformed account ids in vault references", () => {
    expect(
      isVaultV1({
        ...vault,
        originGrants: [{ accountIds: ["not-an-account"], origin: "https://example.com" }],
      }),
    ).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        signingKeys: [{ accountId: "not-an-account", privateKey: "0x456" }],
      }),
    ).toBe(false);
  });

  test("rejects invalid field elements in account and signing key fields", () => {
    expect(isVaultV1({ ...vault, accounts: [{ ...account, classHash: "not-hex" }] })).toBe(false);
    expect(isVaultV1({ ...vault, accounts: [{ ...account, classHash: "0x0" }] })).toBe(false);
    expect(isVaultV1({ ...vault, accounts: [{ ...account, address: "0x0" }] })).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        accounts: [
          {
            ...account,
            publicKeyX: "0x800000000000011000000000000000000000000000000000000000000000001",
          },
        ],
      }),
    ).toBe(false);
    expect(isVaultV1({ ...vault, accounts: [{ ...account, publicKeyX: "0x0" }] })).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        signingKeys: [{ accountId: account.id, privateKey: "not-hex" }],
      }),
    ).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        signingKeys: [
          {
            accountId: account.id,
            privateKey: "0x800000000000011000000000000000000000000000000000000000000000001",
          },
        ],
      }),
    ).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        signingKeys: [{ accountId: account.id, privateKey: "0x0" }],
      }),
    ).toBe(false);
  });

  test("rejects duplicate origin grants and duplicate grant accounts", () => {
    expect(
      isVaultV1({
        ...vault,
        originGrants: [{ accountIds: [], origin: "https://example.com" }],
      }),
    ).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        originGrants: [
          { accountIds: [account.id], origin: "https://example.com" },
          { accountIds: [account.id], origin: "https://example.com" },
        ],
      }),
    ).toBe(false);
    expect(
      isVaultV1({
        ...vault,
        originGrants: [{ accountIds: [account.id, account.id], origin: "https://example.com" }],
      }),
    ).toBe(false);
  });

  test("rejects persisted grants for insecure origins", () => {
    expect(
      isVaultV1({
        ...vault,
        originGrants: [{ accountIds: [account.id], origin: "http://example.com" }],
      }),
    ).toBe(false);
  });

  test("rejects duplicate signing keys", () => {
    const signingKey = { accountId: account.id, privateKey: "0x456" };

    expect(isVaultV1({ ...vault, signingKeys: [signingKey, signingKey] })).toBe(false);
  });

  test("rejects account records without signing keys", () => {
    expect(isVaultV1({ ...vault, signingKeys: [] })).toBe(false);
  });
});
