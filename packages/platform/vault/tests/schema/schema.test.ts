/**
 * Vault schema checks reject ambiguous decrypted wallet state.
 */
import { describe, expect, test } from "bun:test";
import { ARGENT_ACCOUNT_CONTRACT } from "@bramble/starknet/account-contracts";
import {
  CURRENT_SCHEMA_VERSION,
  emptyVault,
  isVaultV1,
  isVaultV3,
  isVaultV4,
  isVaultV5,
  isVaultV7,
  isVaultV8,
  isVaultV12,
} from "@bramble/vault/schema";
import {
  type AccountRef,
  isAccountId,
  isAccountIdForNetwork,
  isKeylessAccount,
} from "@bramble/wallet-model/accounts";
import { ledgerAccountPath, READY_EIP2645_APPLICATION } from "@bramble/wallet-model/ledger-path";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { asV7, withoutScopes } from "./legacy-stamp";

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

const legacyV3 = { ...vault, mnemonic: null, schemaVersion: 3 as const };
const legacyV4 = { ...legacyV3, accountSecrets: [], schemaVersion: 4 as const };
const legacyV5 = { ...legacyV4, schemaVersion: 5 as const };
const currentAccount = { accountContractType: "openzeppelin" as const, ...account };
const currentVault = {
  ...legacyV4,
  accounts: [currentAccount],
  importedSeeds: [],
  schemaVersion: CURRENT_SCHEMA_VERSION,
  shadowAccountScopes: [],
};

describe("isVaultV12 (current schema)", () => {
  test("accepts current vaults with or without a stored phrase", () => {
    expect(isVaultV12(currentVault)).toBe(true);
    expect(isVaultV12({ ...currentVault, mnemonic: "correct horse battery staple" })).toBe(true);
    expect(emptyVault().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(isVaultV12(emptyVault())).toBe(true);
    expect(isVaultV5(legacyV5)).toBe(true);
  });

  test("rejects legacy v1 vaults and version mismatches", () => {
    expect(isVaultV12(vault)).toBe(false);
    expect(isVaultV12({ ...currentVault, schemaVersion: 1 })).toBe(false);
    expect(isVaultV1(currentVault)).toBe(false);
    expect(isVaultV3(legacyV3)).toBe(true);
    expect(isVaultV4(legacyV4)).toBe(true);
  });

  test("rejects non-canonical account aliases in the current schema", () => {
    const alias = "SN_SEPOLIA:0x0123";
    expect(
      isVaultV12({
        ...currentVault,
        accounts: [{ ...currentAccount, address: "0x0123", id: alias }],
        activeAccountId: alias,
        originGrants: [{ accountIds: [alias], origin: "https://example.com" }],
        signingKeys: [{ accountId: alias, privateKey: "0x0456" }],
      }),
    ).toBe(false);
  });

  test("rejects a missing or malformed recovery phrase", () => {
    const { mnemonic: _mnemonic, ...withoutMnemonic } = currentVault;

    expect(isVaultV12(withoutMnemonic)).toBe(false);
    expect(isVaultV12({ ...currentVault, mnemonic: "" })).toBe(false);
    expect(isVaultV12({ ...currentVault, mnemonic: 42 })).toBe(false);
  });

  test("rejects unexpected keys", () => {
    expect(isVaultV12({ ...currentVault, label: "unexpected" })).toBe(false);
  });

  test("binds every imported-seed reference or rejects the vault", () => {
    const withSeed = {
      ...currentVault,
      accounts: [
        {
          ...currentAccount,
          derivation: { ...currentAccount.derivation, seedId: "phrase-1" },
        },
      ],
      importedSeeds: [{ id: "phrase-1", mnemonic: "correct horse battery staple" }],
    };
    expect(isVaultV12(withSeed)).toBe(true);
    // A dangling handle would break reveal and re-derivation: fail closed.
    expect(isVaultV12({ ...withSeed, importedSeeds: [] })).toBe(false);
    // Handles are the bounded deterministic grammar, ids unique.
    expect(
      isVaultV12({
        ...withSeed,
        importedSeeds: [{ id: "anything", mnemonic: "correct horse battery staple" }],
      }),
    ).toBe(false);
    expect(
      isVaultV12({
        ...withSeed,
        importedSeeds: [
          { id: "phrase-1", mnemonic: "correct horse battery staple" },
          { id: "phrase-1", mnemonic: "correct horse battery staple" },
        ],
      }),
    ).toBe(false);
    // The retained phrase itself must be mnemonic-shaped.
    expect(isVaultV12({ ...withSeed, importedSeeds: [{ id: "phrase-1", mnemonic: "" }] })).toBe(
      false,
    );
  });

  test("rejects an Argent discriminator bound to an unpinned class", () => {
    const argent = {
      ...currentAccount,
      accountContractType: "argent",
      classHash: canonicalFelt(ARGENT_ACCOUNT_CONTRACT.classHash),
      deploymentSalt: currentAccount.publicKeyX,
    };
    expect(isVaultV12({ ...currentVault, accounts: [argent] })).toBe(true);
    expect(isVaultV12({ ...currentVault, accounts: [{ ...argent, classHash: "0x123" }] })).toBe(
      false,
    );
  });
});

const ledgerAccount = {
  accountContractType: "openzeppelin" as const,
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
  accountSecrets: [],
  activeAccountId: ledgerAccount.id,
  importedSeeds: [],
  mnemonic: null,
  originGrants: [],
  schemaVersion: CURRENT_SCHEMA_VERSION,
  shadowAccountScopes: [],
  signingKeys: [],
};

describe("mnemonic-less Ledger-only vault", () => {
  test("validates a keyless Ledger vault that stores no recovery phrase", () => {
    expect(isVaultV12(ledgerOnlyVault)).toBe(true);
    expect(isKeylessAccount(ledgerAccount as AccountRef)).toBe(true);
  });

  test("admits a Ledger account restored at Ready's path when marker and path agree", () => {
    const readyAccount = {
      ...ledgerAccount,
      accountContractType: "argent" as const,
      classHash: canonicalFelt(ARGENT_ACCOUNT_CONTRACT.classHash) as string,
      deploymentSalt: ledgerAccount.publicKeyX,
      derivation: {
        accountIndex: 12,
        eip2645application: READY_EIP2645_APPLICATION,
        kind: "ledger" as const,
        path: ledgerAccountPath(12, READY_EIP2645_APPLICATION),
      },
    };
    const readyVault = {
      ...ledgerOnlyVault,
      accounts: [readyAccount],
      activeAccountId: readyAccount.id,
    };
    expect(isVaultV12(readyVault)).toBe(true);
    // The Ready scheme is admitted from v9 onward: the same record stamped v8
    // or v7 is refused, while a Bramble-path Ledger account is accepted at every version
    // that admits Ledger accounts at all.
    expect(isVaultV8({ ...withoutScopes(readyVault), schemaVersion: 8 })).toBe(false);
    expect(isVaultV8({ ...withoutScopes(ledgerOnlyVault), schemaVersion: 8 })).toBe(true);
    const readyV7 = asV7(readyVault);
    const brambleV7 = asV7(ledgerOnlyVault);
    expect(isVaultV7(readyV7)).toBe(false);
    expect(isVaultV7(brambleV7)).toBe(true);
    // Bramble's marker over Ready's path, or Ready's marker over Bramble's path,
    // would sign with a key nobody enumerated: both fail closed.
    expect(
      isVaultV12({
        ...readyVault,
        accounts: [
          {
            ...readyAccount,
            derivation: { ...readyAccount.derivation, eip2645application: "LedgerW" },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isVaultV12({
        ...readyVault,
        accounts: [
          {
            ...readyAccount,
            derivation: { ...readyAccount.derivation, path: ledgerAccountPath(12) },
          },
        ],
      }),
    ).toBe(false);
  });

  test("still accepts the grandfathered legacy null-phrase seed vault", () => {
    // A v1-migrated wallet carries seed accounts with a null mnemonic; that shape
    // stays valid so those wallets never fail closed.
    expect(isVaultV12(currentVault)).toBe(true);
    expect(currentVault.mnemonic).toBeNull();
  });

  test("accepts only canonical Ledger-owned account-secret scopes", () => {
    const key = {
      chainId: "0x534e5f4d41494e",
      poolAddress: "0x123",
      scheme: "ledger-strk20-typed-data-v1" as const,
      viewingKey: "0x654321",
    };
    const withSecret = {
      ...ledgerOnlyVault,
      accountSecrets: [
        {
          accountId: ledgerAccount.id,
          ledgerStrk20ViewingKeys: [key],
        },
      ],
    };

    expect(isVaultV12(withSecret)).toBe(true);
    expect(
      isVaultV12({
        ...withSecret,
        accountSecrets: [{ ...withSecret.accountSecrets[0], accountId: "SN_MAIN:0x999" }],
      }),
    ).toBe(false);
    expect(
      isVaultV12({
        ...withSecret,
        accountSecrets: [
          {
            accountId: ledgerAccount.id,
            ledgerStrk20ViewingKeys: [{ ...key, chainId: "0x534e5f5345504f4c4941" }],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isVaultV12({
        ...withSecret,
        accountSecrets: [
          {
            accountId: ledgerAccount.id,
            ledgerStrk20ViewingKeys: [{ ...key, poolAddress: "0x0123" }],
          },
        ],
      }),
    ).toBe(false);
  });

  test("rejects optional viewing keys on software accounts or duplicate scopes", () => {
    const key = {
      chainId: "0x534e5f4d41494e",
      poolAddress: "0x123",
      scheme: "ledger-strk20-typed-data-v1" as const,
      viewingKey: "0x654321",
    };
    expect(
      isVaultV12({
        ...currentVault,
        accountSecrets: [
          {
            accountId: account.id,
            ledgerStrk20ViewingKeys: [key],
          },
        ],
      }),
    ).toBe(false);
    expect(
      isVaultV12({
        ...ledgerOnlyVault,
        accountSecrets: [
          {
            accountId: ledgerAccount.id,
            ledgerStrk20ViewingKeys: [key, key],
          },
        ],
      }),
    ).toBe(false);
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
    expect(isAccountIdForNetwork(account.id, "SN_SEPOLIA")).toBe(true);
    expect(isAccountIdForNetwork(account.id, "SN_MAIN")).toBe(false);
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
