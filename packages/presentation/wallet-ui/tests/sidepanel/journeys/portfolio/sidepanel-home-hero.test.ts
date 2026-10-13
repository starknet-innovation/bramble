/**
 * Home hero caption checks: the 24h figures are named as price moves with one
 * caveat under the hero, and the caption is gated on a priced baseline.
 */
import { describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";

const status: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_SEPOLIA", name: "Starknet Sepolia" },
  ],
  ready: true,
};

describe("sidepanel home hero caption", () => {
  test("home hero caption states the 24h figures are price moves", () => {
    const balance: TokenBalance = {
      address: "0x00aa",
      balance: "10000000000000000000",
      decimals: 18,
      formatted: "10",
      id: "SN_MAIN:TKN:0x00aa",
      name: "Token",
      networkId: "SN_MAIN",
      symbol: "TKN",
    };
    const html = dashboard(
      "home",
      status,
      [],
      preferences,
      { balances: [balance] },
      null,
      [],
      [],
      { "0x00aa": 5 },
      [],
      null,
      [],
      null,
      { "0x00aa": 4 },
    );
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));

    // The hero names the figure a price move and one caption carries the caveat;
    // the token rows below carry only their own short window.
    expect(hero).toContain("Portfolio price · 4.00% · 24h");
    expect(hero).toContain('class="hero-note"');
    expect(hero).toContain(
      "Price change over 24h at your current balances; sends and receives aren't included.",
    );
  });

  test("home hero omits the caption when there is no priced baseline", () => {
    // Prices exist so the hero renders its change region, but no balance is
    // priced, so portfolioDelta is null and the gate must suppress the caption.
    // Removing the gate renders the caption (or throws on the null delta) here,
    // which the old empty-balances, empty-prices fixture could not detect.
    const html = dashboard(
      "home",
      status,
      [],
      preferences,
      { balances: [] },
      null,
      [],
      [],
      { "0x00aa": 5 },
      [],
      null,
      [],
      null,
      {},
    );
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));

    expect(hero).not.toContain("hero-note");
    expect(hero).not.toContain("Portfolio price");
  });
});
