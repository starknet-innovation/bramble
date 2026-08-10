/**
 * Validator coverage for the panel-facing Ledger response guards: the pending
 * device-sign list, the bare ok acknowledgement, and the derived account list.
 * These parse untrusted background responses at the boundary, so a malformed
 * hash, path, account id, or extra key must be rejected before the panel acts.
 */
import { describe, expect, test } from "bun:test";
import {
  isLedgerAccountStatusResponse,
  isLedgerAccountsResponse,
  isLedgerSignPendingResponse,
  isOkResponse,
} from "../../src/popup/responses";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";

const ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const ID = `SN_MAIN:${ADDRESS}`;

const pending = {
  accountId: ID,
  id: "ledger-sign-1",
  intent: "send-token",
  messageHash: "0xabc",
  path: ledgerAccountPath(0),
  publicKeyX: "0xabc",
};

const ledgerAccount = {
  address: ADDRESS,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(0),
  },
  id: ID,
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

describe("isLedgerSignPendingResponse", () => {
  test("accepts a well-formed pending list", () => {
    expect(isLedgerSignPendingResponse({ ok: true, pending: [pending] })).toBe(true);
    expect(isLedgerSignPendingResponse({ ok: true, pending: [] })).toBe(true);
  });

  test("rejects a bad hash, path, account id, intent, or shape", () => {
    expect(
      isLedgerSignPendingResponse({ ok: true, pending: [{ ...pending, messageHash: "zz" }] }),
    ).toBe(false);
    // An unknown intent is rejected rather than rendered unlabelled: the prompt
    // copy is a total map over the union, so admitting a stray string would mean
    // showing the user a hash with no stated purpose.
    expect(
      isLedgerSignPendingResponse({
        ok: true,
        pending: [{ ...pending, intent: "send-everything" }],
      }),
    ).toBe(false);
    expect(
      isLedgerSignPendingResponse({ ok: true, pending: [{ ...pending, intent: undefined }] }),
    ).toBe(false);
    expect(isLedgerSignPendingResponse({ ok: true, pending: [{ ...pending, path: "m/x" }] })).toBe(
      false,
    );
    expect(
      isLedgerSignPendingResponse({ ok: true, pending: [{ ...pending, accountId: "nope" }] }),
    ).toBe(false);
    expect(
      isLedgerSignPendingResponse({ ok: true, pending: [{ ...pending, publicKeyX: "zz" }] }),
    ).toBe(false);
    expect(isLedgerSignPendingResponse({ ok: true, pending: [{ ...pending, extra: 1 }] })).toBe(
      false,
    );
    expect(isLedgerSignPendingResponse({ ok: false, pending: [] })).toBe(false);
    expect(isLedgerSignPendingResponse({ ok: true })).toBe(false);
    expect(isLedgerSignPendingResponse(null)).toBe(false);
  });
});

describe("isOkResponse", () => {
  test("accepts a bare ok and rejects extras or errors", () => {
    expect(isOkResponse({ ok: true })).toBe(true);
    expect(isOkResponse({ ok: true, extra: 1 })).toBe(false);
    expect(isOkResponse({ ok: false })).toBe(false);
    expect(isOkResponse({ error: "x" })).toBe(false);
  });
});

describe("isLedgerAccountStatusResponse", () => {
  test("accepts a resolved or degraded on-chain status", () => {
    expect(isLedgerAccountStatusResponse({ balance: "1.5 STRK", deployed: true, ok: true })).toBe(
      true,
    );
    expect(isLedgerAccountStatusResponse({ balance: null, deployed: null, ok: true })).toBe(true);
    expect(isLedgerAccountStatusResponse({ balance: "0 STRK", deployed: false, ok: true })).toBe(
      true,
    );
  });

  test("rejects a wrong-typed field, extra key, or non-ok shape", () => {
    expect(isLedgerAccountStatusResponse({ balance: 1.5, deployed: true, ok: true })).toBe(false);
    expect(isLedgerAccountStatusResponse({ balance: null, deployed: "yes", ok: true })).toBe(false);
    expect(
      isLedgerAccountStatusResponse({ balance: null, deployed: null, extra: 1, ok: true }),
    ).toBe(false);
    expect(isLedgerAccountStatusResponse({ balance: null, deployed: null, ok: false })).toBe(false);
    expect(isLedgerAccountStatusResponse(null)).toBe(false);
  });
});

describe("isLedgerAccountsResponse", () => {
  test("accepts a list of keyless Ledger accounts", () => {
    expect(isLedgerAccountsResponse({ accounts: [ledgerAccount], ok: true })).toBe(true);
    expect(isLedgerAccountsResponse({ accounts: [], ok: true })).toBe(true);
  });

  test("rejects a non-Ledger account, duplicates, or a bad shape", () => {
    const derived = {
      ...ledgerAccount,
      derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
      publicKeyY: ledgerAccount.publicKeyX,
    };
    expect(isLedgerAccountsResponse({ accounts: [derived], ok: true })).toBe(false);
    expect(isLedgerAccountsResponse({ accounts: [ledgerAccount, ledgerAccount], ok: true })).toBe(
      false,
    );
    expect(isLedgerAccountsResponse({ accounts: [ledgerAccount], ok: false })).toBe(false);
    expect(isLedgerAccountsResponse({ ok: true })).toBe(false);
  });
});
