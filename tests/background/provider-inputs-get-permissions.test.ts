/**
 * `readGetPermissionsInput` guard coverage: malformed provider permission
 * queries (wrong type, extra keys, missing origin, non-record) return null,
 * exercising the false branch of the input guard; a well-formed query parses.
 */
import { describe, expect, test } from "bun:test";
import { readGetPermissionsInput } from "../../apps/extension/src/background/provider-inputs";

describe("readGetPermissionsInput invalid-shape branch", () => {
  test("returns null for malformed provider payloads", () => {
    // Not a record.
    expect(readGetPermissionsInput(null)).toBeNull();
    expect(readGetPermissionsInput("wallet.getPermissions")).toBeNull();
    // Wrong message type.
    expect(
      readGetPermissionsInput({ origin: "https://dapp.example", type: "wallet.other" }),
    ).toBeNull();
    // Unexpected extra key.
    expect(
      readGetPermissionsInput({
        extra: true,
        origin: "https://dapp.example",
        type: "wallet.getPermissions",
      }),
    ).toBeNull();
    // Origin that does not normalize to a wallet origin.
    expect(
      readGetPermissionsInput({ origin: "not-a-url", type: "wallet.getPermissions" }),
    ).toBeNull();
  });

  test("parses a well-formed permission query", () => {
    expect(
      readGetPermissionsInput({ origin: "https://dapp.example", type: "wallet.getPermissions" }),
    ).toEqual({ origin: "https://dapp.example" });
  });
});
