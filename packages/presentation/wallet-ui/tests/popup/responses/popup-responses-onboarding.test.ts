/**
 * Onboarding mnemonic-validity response guard checks.
 */
import { describe, expect, test } from "bun:test";
import { isValidateMnemonicResponse } from "../../../src/popup/responses/responses-onboarding";

describe("validate mnemonic response", () => {
  test("accepts only a boolean verdict envelope", () => {
    expect(isValidateMnemonicResponse({ ok: true, valid: true })).toBe(true);
    expect(isValidateMnemonicResponse({ ok: true, valid: false })).toBe(true);
    expect(isValidateMnemonicResponse({ ok: true, valid: "yes" })).toBe(false);
    expect(isValidateMnemonicResponse({ mnemonic: "x", ok: true, valid: true })).toBe(false);
  });
});
