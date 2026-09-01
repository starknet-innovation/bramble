/**
 * Onboarding mnemonic-validity response guard checks.
 */
import { describe, expect, test } from "bun:test";
import {
  isRecoveredAccountsResponse,
  isRecoveryDiscoveryResponse,
  isValidateMnemonicResponse,
} from "../../../src/popup/responses/responses-onboarding";
import { account } from "../../support/runtime-client-fixtures";

describe("validate mnemonic response", () => {
  test("accepts only a boolean verdict envelope", () => {
    expect(isValidateMnemonicResponse({ ok: true, valid: true })).toBe(true);
    expect(isValidateMnemonicResponse({ ok: true, valid: false })).toBe(true);
    expect(isValidateMnemonicResponse({ ok: true, valid: "yes" })).toBe(false);
    expect(isValidateMnemonicResponse({ mnemonic: "x", ok: true, valid: true })).toBe(false);
  });
});

describe("recovery account responses", () => {
  test("accepts only exact public discovery and restored-account envelopes", () => {
    const candidate = { account, deployed: true, funded: false };
    expect(
      isRecoveryDiscoveryResponse({
        candidates: [candidate],
        complete: false,
        nextIndex: 4,
        ok: true,
      }),
    ).toBe(true);
    expect(
      isRecoveryDiscoveryResponse({
        candidates: [{ ...candidate, mnemonic: "secret" }],
        complete: false,
        nextIndex: 4,
        ok: true,
      }),
    ).toBe(false);
    expect(isRecoveredAccountsResponse({ accounts: [account], ok: true })).toBe(true);
    expect(isRecoveredAccountsResponse({ accounts: [account], mnemonic: "secret", ok: true })).toBe(
      false,
    );
  });
});
