/**
 * Popup response validator checks reject malformed background data before rendering.
 */
import { describe, expect, test } from "bun:test";
import {
  isAccountsResponse,
  isApprovalDecisionResponse,
  isCreateAccountResponse,
  isErrorResponse,
  isPendingApprovalsResponse,
  isWalletStatus,
} from "../src/popup/responses";

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

  test("validates wallet status shape", () => {
    const hiddenDebug = {
      accountCount: 1,
      activeAccountId: account.id,
      hasVault: true,
      locked: false,
      network: "Starknet Sepolia",
      ready: true,
    };
    Object.defineProperty(hiddenDebug, "debug", { value: true });

    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: account.id,
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        ready: true,
      }),
    ).toBe(true);
    expect(isWalletStatus({ accountCount: -1 })).toBe(false);
    expect(isWalletStatus({ accountCount: Number.NaN })).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: "not-an-account",
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        ready: true,
      }),
    ).toBe(false);
    expect(isWalletStatus(hiddenDebug)).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 0,
        activeAccountId: account.id,
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: null,
        hasVault: false,
        locked: false,
        network: "Starknet Sepolia",
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: account.id,
        debug: true,
        hasVault: true,
        locked: false,
        network: "Starknet Sepolia",
        ready: true,
      }),
    ).toBe(false);
    expect(
      isWalletStatus({
        accountCount: 1,
        activeAccountId: null,
        hasVault: true,
        locked: false,
        network: "",
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
});
