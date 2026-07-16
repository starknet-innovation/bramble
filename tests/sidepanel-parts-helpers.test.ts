/**
 * Side-panel template atoms' fallback branches: the friendly-name and avatar
 * BigInt catch arms for an unparseable address, and the FRI fee formatter across
 * whole, fractional, and unparseable inputs.
 */
import { describe, expect, test } from "bun:test";
import { accountAvatar, accountDisplayName, formatFri, isWalletView } from "../src/sidepanel/parts";
import type { AccountRef } from "../src/storage/vault-schema";

const account = (address: string): AccountRef => ({
  address,
  classHash: "0x2",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${address}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x3",
  publicKeyY: "0x4",
});

describe("isWalletView", () => {
  test("rejects non-view strings and non-strings", () => {
    expect(isWalletView("home")).toBe(true);
    expect(isWalletView("not-a-view")).toBe(false);
    expect(isWalletView(42)).toBe(false);
  });
});

describe("accountDisplayName", () => {
  test("prefers a user label when present", () => {
    expect(
      accountDisplayName(account("0x1"), {
        accountLabels: { "SN_MAIN:0x1": "Savings" },
      } as never),
    ).toBe("Savings");
  });

  test("derives a deterministic friendly name from a valid address", () => {
    const name = accountDisplayName(account("0x0"), null);
    // adjective + animal; 0x0 -> first of each list.
    expect(name).toBe("Amber Otter");
  });

  test("falls back to the zero-derived name when the address is not a felt", () => {
    // BigInt("not-hex") throws, so bits defaults to 0n and the name is the
    // first adjective/animal pair rather than crashing.
    expect(accountDisplayName(account("not-hex"), null)).toBe("Amber Otter");
  });
});

describe("accountAvatar", () => {
  test("chooses a palette tone from the address", () => {
    expect(accountAvatar("0x2")).toContain("var(--mc-avatar-2)");
  });

  test("falls back to tone 0 for an unparseable address", () => {
    // The BigInt catch drops to bits = 0n, so tone 0 renders instead of throwing.
    expect(accountAvatar("not-hex")).toContain("var(--mc-avatar-0)");
  });
});

describe("formatFri", () => {
  test("formats a whole-STRK amount", () => {
    expect(formatFri((10n ** 18n).toString())).toBe("1 STRK");
  });

  test("formats a fractional amount, trimming trailing zeros", () => {
    expect(formatFri((10n ** 18n + 10n ** 17n * 5n).toString())).toBe("1.5 STRK");
  });

  test("returns the raw input unchanged when it is not a number", () => {
    expect(formatFri("not-a-number")).toBe("not-a-number");
  });
});
