/**
 * Side-panel template atoms' fallback branches: the friendly-name and avatar
 * BigInt catch arms for an unparseable address, and the FRI fee formatter across
 * whole, fractional, and unparseable inputs.
 */
import { describe, expect, test } from "bun:test";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  accountAvatar,
  accountDisplayName,
  accountIdAddress,
  copyButton,
  dockScreen,
  flowScreen,
  formatFri,
  inlineCopyButton,
  isWalletView,
} from "../../../src/sidepanel/shared/parts";

const account = (address: string): AccountRef => ({
  accountContractType: "openzeppelin",
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

describe("screen wrappers", () => {
  test("escapes a malformed view id without escaping trusted renderer markup", () => {
    for (const wrap of [dockScreen, flowScreen]) {
      const html = wrap('" onclick="alert(1)' as never, "<p>Trusted renderer output</p>");
      expect(html).toContain("wallet-screen-&quot; onclick=&quot;alert(1)");
      expect(html).toContain("<p>Trusted renderer output</p>");
    }
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
  test("is stable across equivalent address spellings", () => {
    expect(accountAvatar("0x1234")).toBe(accountAvatar("0x001234"));
  });

  test("gives representative addresses distinct birds", () => {
    const avatars = ["0x1", "0x2", "0x3", "0x4", "0x100", "0x200"].map(accountAvatar);
    expect(new Set(avatars).size).toBe(avatars.length);
    for (const avatar of avatars) {
      expect(avatar).toContain('class="avatar-bird"');
      expect(avatar).toMatch(/fill="var\(--bramble-account-avatar-ground-\d\)"/);
      expect(avatar).not.toContain('class="avatar-frame"');
    }
  });

  test("falls back safely without reflecting malformed input into markup", () => {
    const fallback = accountAvatar("not-hex<script>");
    expect(fallback).toBe(accountAvatar("0x0"));
    expect(fallback).toBe(accountAvatar("-1"));
    expect(fallback).not.toContain("script");
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

describe("accountIdAddress", () => {
  test("returns the address half of a network-scoped account id", () => {
    expect(accountIdAddress("SN_MAIN:0x1234")).toBe("0x1234");
  });

  test("passes a bare value through untouched", () => {
    expect(accountIdAddress("0x1234")).toBe("0x1234");
  });
});

describe("copy controls", () => {
  test("both carry the full value on data-copy and the label as the accessible name", () => {
    const value = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
    for (const html of [
      copyButton(value, "Copy address"),
      inlineCopyButton(value, "Copy address"),
    ]) {
      expect(html).toContain(`data-copy="${value}"`);
      expect(html).toContain('aria-label="Copy address"');
      expect(html).toContain('type="button"');
    }
  });

  test("the inline variant is the ghost, compact one; the receipt variant is unchanged", () => {
    expect(inlineCopyButton("0x1", "Copy")).toContain('class="icon-button ghost copy-inline"');
    expect(copyButton("0x1", "Copy")).toContain('class="icon-button"');
    expect(copyButton("0x1", "Copy")).not.toContain("copy-inline");
  });

  test("escapes the value and label rather than trusting them", () => {
    const html = inlineCopyButton('0x1" onclick="steal()', "Copy <b>");
    expect(html).toContain('data-copy="0x1&quot; onclick=&quot;steal()"');
    expect(html).not.toContain('" onclick="');
    expect(html).toContain("&lt;b&gt;");
  });
});
