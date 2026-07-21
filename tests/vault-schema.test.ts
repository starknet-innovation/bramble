/**
 * Vault schema checks reject ambiguous decrypted wallet state.
 */
import { describe, expect, test } from "bun:test";
import { ledgerAccountPath } from "../src/starknet/ledger-path";
import {
  type AccountRef,
  accountsRequireMnemonic,
  CURRENT_SCHEMA_VERSION,
  emptyVault,
  isAccountId,
  isKeylessAccount,
  isVaultV1,
  isVaultV3,
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

const currentVault = { ...vault, mnemonic: null, schemaVersion: 3 as const };

describe("isVaultV3 (current schema)", () => {
  test("accepts current vaults with or without a stored phrase", () => {
    expect(isVaultV3(currentVault)).toBe(true);
    expect(isVaultV3({ ...currentVault, mnemonic: "correct horse battery staple" })).toBe(true);
    expect(emptyVault().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(isVaultV3(emptyVault())).toBe(true);
  });

  test("rejects legacy v1 vaults and version mismatches", () => {
    expect(isVaultV3(vault)).toBe(false);
    expect(isVaultV3({ ...currentVault, schemaVersion: 1 })).toBe(false);
    expect(isVaultV1(currentVault)).toBe(false);
  });

  test("rejects a missing or malformed recovery phrase", () => {
    const withoutMnemonic = {
      accounts: currentVault.accounts,
      activeAccountId: currentVault.activeAccountId,
      originGrants: currentVault.originGrants,
      schemaVersion: 3 as const,
      signingKeys: currentVault.signingKeys,
    };

    expect(isVaultV3(withoutMnemonic)).toBe(false);
    expect(isVaultV3({ ...currentVault, mnemonic: "" })).toBe(false);
    expect(isVaultV3({ ...currentVault, mnemonic: 42 })).toBe(false);
  });

  test("rejects unexpected keys", () => {
    expect(isVaultV3({ ...currentVault, label: "unexpected" })).toBe(false);
  });
});

const ledgerAccount = {
  address: "0xdef123",
  classHash: "0x111111",
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW" as const,
    kind: "ledger" as const,
    path: ledgerAccountPath(0),
  },
  id: "SN_MAIN:0xdef123",
  networkId: "SN_MAIN",
  publicKeyX: "0xabc",
};

const ledgerOnlyVault = {
  accounts: [ledgerAccount],
  activeAccountId: ledgerAccount.id,
  mnemonic: null,
  originGrants: [],
  schemaVersion: 3 as const,
  signingKeys: [],
};

describe("mnemonic-less Ledger-only vault", () => {
  test("validates a keyless Ledger vault that stores no recovery phrase", () => {
    // The mnemonic-less Ledger-only wallet needs no schema bump beyond v3: a null
    // mnemonic with an all-keyless account set and empty signing keys is already
    // a valid v3 vault under the relaxed account↔signingKey bijection.
    expect(isVaultV3(ledgerOnlyVault)).toBe(true);
    expect(isKeylessAccount(ledgerAccount as AccountRef)).toBe(true);
  });

  test("still accepts the grandfathered legacy null-phrase seed vault", () => {
    // A v1-migrated wallet carries seed accounts with a null mnemonic; that shape
    // stays valid so those wallets never fail closed.
    expect(isVaultV3(currentVault)).toBe(true);
    expect(currentVault.mnemonic).toBeNull();
  });

  test("accountsRequireMnemonic is the one source of truth for phrase coverage", () => {
    const ledger = ledgerAccount as AccountRef;
    const seed = account as AccountRef;
    expect(accountsRequireMnemonic([])).toBe(false);
    expect(accountsRequireMnemonic([ledger])).toBe(false);
    expect(accountsRequireMnemonic([seed])).toBe(true);
    expect(accountsRequireMnemonic([ledger, seed])).toBe(true);
  });
});

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
