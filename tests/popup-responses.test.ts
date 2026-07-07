/**
 * Popup response validator checks reject malformed background data before rendering.
 */
import { describe, expect, test } from "bun:test";
import {
  isAccountsResponse,
  isApprovalDecisionResponse,
  isBalancesResponse,
  isCreateAccountResponse,
  isErrorResponse,
  isGenerateMnemonicResponse,
  isPendingApprovalsResponse,
  isPreferencesResponse,
  isTransferResponse,
  isWalletStatus,
} from "../src/popup/responses";
import { defaultWalletPreferences } from "../src/storage/preferences-store";

describe("popup response validators", () => {
  const approvalId = "123e4567-e89b-42d3-a456-426614174000";
  const account = {
    address: "0x123",
    classHash: "0xabc",
    derivation: {
      accountIndex: 0,
      addressIndex: 0,
      kind: "starknet-bip44" as const,
    },
    id: "SN_SEPOLIA:0x123",
    networkId: "SN_SEPOLIA" as const,
    publicKeyX: "0xabc",
    publicKeyY: "0xdef",
  };
  const networks = [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }];

  test("validates wallet status shape", () => {
    const hiddenDebug = {
      accountCount: 1,
      activeAccountId: account.id,
      accounts: [account],
      hasVault: true,
      locked: false,
      network: "Starknet Sepolia",
      networkId: "SN_SEPOLIA",
      networks,
      ready: true,
    };
    Object.defineProperty(hiddenDebug, "debug", { value: true });

    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: account.id,
        accounts: [account],
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(true);
    expect(isWalletStatus({ accountCount: -1 })).toBe(false);
    expect(isWalletStatus({ accountCount: Number.NaN })).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: "not-an-account",
        accounts: [account],
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
    expect(isWalletStatus(hiddenDebug)).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 0,
        activeAccountId: account.id,
        accounts: [],
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: null,
        accounts: [account],
        hasVault: false,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: account.id,
        accounts: [account],
        debug: true,
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: null,
        accounts: [account],
        hasVault: true,
        locked: false,
        network: "",
        networkId: "SN_SEPOLIA",
        networks,
        ready: true,
      }),
    ).toBe(false);
  });

  test("validates account and error responses", () => {
    expect(isCreateAccountResponse({ account, ok: true })).toBe(true);
    expect(isCreateAccountResponse({ account: null, ok: true })).toBe(false);
    expect(isCreateAccountResponse({ account: { ...account, address: "not-hex" }, ok: true })).toBe(
      false,
    );
    expect(
      isCreateAccountResponse({ account: { ...account, privateKey: "0x456" }, ok: true }),
    ).toBe(false);
    expect(isErrorResponse({ error: "bad passphrase" })).toBe(true);
    expect(isErrorResponse({ code: "bad", error: "bad passphrase" })).toBe(false);
    expect(isErrorResponse({ error: 1 })).toBe(false);
    expect(isErrorResponse({ error: "" })).toBe(false);
  });

  test("validates generated mnemonic responses", () => {
    const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";

    expect(isGenerateMnemonicResponse({ mnemonic, ok: true })).toBe(true);
    expect(isGenerateMnemonicResponse({ mnemonic: "too short", ok: true })).toBe(false);
    expect(isGenerateMnemonicResponse({ mnemonic, ok: false })).toBe(false);
    expect(isGenerateMnemonicResponse({ debug: true, mnemonic, ok: true })).toBe(false);
  });

  test("validates pending approval items before popup rendering", () => {
    const sparsePending = new Array<unknown>(1);

    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ id: approvalId, origin: "https://example.com" }],
      }),
    ).toBe(true);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ id: approvalId, label: "unexpected", origin: "https://example.com" }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          { id: approvalId, origin: "https://example.com" },
          { id: approvalId, origin: "https://other.example" },
        ],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          { id: approvalId, origin: "https://example.com" },
          { id: "123e4567-e89b-42d3-a456-426614174001", origin: "https://example.com" },
        ],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        debug: true,
        ok: true,
        pending: [{ id: approvalId, origin: "https://example.com" }],
      }),
    ).toBe(false);
    expect(isPendingApprovalsResponse({ ok: true, pending: [{ id: approvalId }] })).toBe(false);
    expect(isPendingApprovalsResponse({ ok: true, pending: sparsePending })).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ id: "", origin: "https://example.com" }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ id: approvalId, origin: "http://example.com" }],
      }),
    ).toBe(false);
    expect(isPendingApprovalsResponse({ ok: true, pending: [null] })).toBe(false);
  });

  test("validates approval decision responses before popup state updates", () => {
    const sparseAccounts = new Array<unknown>(1);

    expect(isAccountsResponse({ accounts: [account], ok: true })).toBe(true);
    expect(isAccountsResponse({ accounts: [account, account], ok: true })).toBe(false);
    expect(isAccountsResponse({ accounts: sparseAccounts, ok: true })).toBe(false);
    expect(isAccountsResponse({ accounts: [{ ...account, privateKey: "0x456" }], ok: true })).toBe(
      false,
    );
    expect(
      isApprovalDecisionResponse({
        ok: true,
        pending: [{ id: approvalId, origin: "https://example.com" }],
      }),
    ).toBe(true);
    expect(isApprovalDecisionResponse({ ok: true })).toBe(false);
  });

  test("validates preferences, balance, and transfer responses", () => {
    const preferences = defaultWalletPreferences();
    const token = preferences.tokens[0];

    expect(isPreferencesResponse({ ok: true, preferences })).toBe(true);
    expect(isPreferencesResponse({ ok: true, preferences: { schemaVersion: 1 } })).toBe(false);
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [{ ...token, balance: "100", formatted: "0.0000000000000001" }],
        networkId: "SN_SEPOLIA",
        ok: true,
      }),
    ).toBe(true);
    expect(
      isBalancesResponse({
        accountId: account.id,
        balances: [{ ...token, balance: "-1", formatted: "0" }],
        networkId: "SN_SEPOLIA",
        ok: true,
      }),
    ).toBe(false);
    expect(isTransferResponse({ ok: true, transactionHash: "0x123" })).toBe(true);
    expect(isTransferResponse({ ok: true, transactionHash: "not-hex" })).toBe(false);
  });
});
