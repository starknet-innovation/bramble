/**
 * The multisig private-balance section names the consequence of the viewing
 * key, and only when this network has a pool.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { TokenBalance } from "@bramble/starknet/rpc";
import { multisigPortfolio } from "../../../../src/sidepanel/journeys/multisig/multisig-portfolio";
import { EMPTY_MULTISIG_PORTFOLIO } from "../../../../src/sidepanel/journeys/multisig/multisig-portfolio-data";
import { multisigStrk20KeyPanel } from "../../../../src/sidepanel/journeys/multisig/multisig-strk20-key-view";

describe("multisig private balances", () => {
  test("says who can see private activity when a pool is configured", () => {
    const html = multisigStrk20KeyPanel(
      "SN_MAIN",
      defaultWalletPreferences(),
      EMPTY_MULTISIG_PORTFOLIO,
    );
    expect(html).toContain("Private balances");
    expect(html).toContain(
      "Anyone with the viewing key can see all of this multisig's private activity.",
    );
    expect(html).toContain("Create key");
    expect(html).toContain("Share key");
    expect(html).toContain("Drop key");
    expect(html).toContain("Register");
    expect(html).toContain("Deposit");
    expect(html).toContain("Transfer");
    expect(html).toContain("Withdraw");
    expect(html).toContain("Send");
    expect(html).toContain("Refresh");
    expect(html).toContain("hidden");
    expect(html).toContain("USDC");
    expect(html).toContain("STRK");
    expect(html).toContain("data-ms-strk20-authorizations");
  });

  test("offers a tracked token with this multisig's public balance", () => {
    const preferences = defaultWalletPreferences();
    const usdc = preferences.tokens.find(
      (token) => token.symbol === "USDC" && token.networkId === "SN_MAIN",
    );
    if (!usdc) throw new Error("USDC is tracked on mainnet");
    const balance: TokenBalance = { ...usdc, balance: "1500000", formatted: "1.5" };
    const html = multisigStrk20KeyPanel("SN_MAIN", preferences, {
      balances: { balances: [balance] },
      changes: {},
      currency: "usd",
      prices: {},
    });
    expect(html).toContain(`value="${usdc.id}"`);
    expect(html).toContain('data-symbol="USDC"');
    expect(html).toContain('data-public-balance="1.5"');
    expect(html).toContain("USDC · 1.5");
  });

  test("the multisig home builds the section from its own balances, escaped", () => {
    const preferences = defaultWalletPreferences();
    const usdc = preferences.tokens.find(
      (token) => token.symbol === "USDC" && token.networkId === "SN_MAIN",
    );
    if (!usdc) throw new Error("USDC is tracked on mainnet");
    const hostile = '"><img src=x onerror=alert(1)>';
    const balance: TokenBalance = { ...usdc, balance: "1500000", formatted: hostile };
    const html = multisigPortfolio({
      authorityAvailable: true,
      canPropose: true,
      data: { balances: { balances: [balance] }, changes: {}, currency: "usd", prices: {} },
      intentList: { emptyMessage: "No intents", heading: "Intents", items: [] },
      openCount: 0,
      preferences,
      record: {
        accountContractType: "argent-multisig",
        address: "0x999",
        classHash: "0x123",
        id: "SN_MAIN:0x999",
        name: "Treasury",
        networkId: "SN_MAIN",
      },
      signerKnown: true,
    });
    expect(html.split("data-ms-strk20-key-panel")).toHaveLength(2);
    expect(html).toContain(`value="${usdc.id}"`);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("is absent when private balances are not configured", () => {
    const preferences = defaultWalletPreferences();
    const { strk20Networks: _networks, ...rest } = preferences;
    expect(multisigStrk20KeyPanel("SN_MAIN", { ...rest }, EMPTY_MULTISIG_PORTFOLIO)).toBe("");
    expect(multisigStrk20KeyPanel("SN_SEPOLIA", preferences, EMPTY_MULTISIG_PORTFOLIO)).toBe("");
  });
});
