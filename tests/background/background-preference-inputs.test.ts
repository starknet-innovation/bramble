/**
 * Preference message parser checks reject malformed display-setting envelopes
 * before they reach the preferences store.
 */
import { describe, expect, test } from "bun:test";
import { readSetDisplayInput } from "../../src/background/preference-inputs";

describe("readSetDisplayInput", () => {
  test("reads a well-formed display-settings message", () => {
    expect(
      readSetDisplayInput({ displayCurrency: "eur", theme: "dark", type: "wallet.setDisplay" }),
    ).toEqual({ displayCurrency: "eur", theme: "dark" });
  });

  test("rejects a non-record, wrong-type, or unknown-key envelope", () => {
    expect(readSetDisplayInput(null)).toBeNull();
    expect(readSetDisplayInput({ theme: "dark", type: "wallet.setRpcOverride" })).toBeNull();
    expect(
      readSetDisplayInput({ debug: true, theme: "dark", type: "wallet.setDisplay" }),
    ).toBeNull();
  });

  test("rejects unknown currency or theme values", () => {
    expect(readSetDisplayInput({ displayCurrency: "jpy", type: "wallet.setDisplay" })).toBeNull();
    expect(readSetDisplayInput({ theme: "solarized", type: "wallet.setDisplay" })).toBeNull();
  });
});
