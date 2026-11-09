/**
 * Home hero checks: the hero carries the value and 24h delta without identity
 * copy, the 24h figures are named as price moves with one caveat under the
 * hero, and the caption is gated on a priced baseline.
 */
import { describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import {
  EMPTY_ALLOWANCE_LISTING,
  type TokenBalance,
  type WalletStatus,
} from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";

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

// Private discovery has settled with nothing shielded, so the hero prints its
// total instead of holding "—" for a private part still to come (issue 795).
const settledPrivacy: PrivacyDisclosureState = {
  error: null,
  loading: false,
  value: {
    accountId: account.id,
    balances: [],
    networkId: "SN_MAIN",
    poolFeeFri: "0x1",
    relayConfigured: true,
    registration: "unregistered",
  },
};

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

// The home hero for these balances, prices and 24h changes. Every dashboard
// argument between the changes and the privacy state keeps its default.
const heroOf = (
  balances: readonly TokenBalance[],
  changes: Readonly<Record<string, number>>,
  chart: readonly number[] = [],
): string => {
  const html = dashboard(
    "home",
    status,
    [],
    preferences,
    { balances },
    null,
    [],
    [],
    { "0x00aa": 5 },
    chart,
    null,
    EMPTY_ALLOWANCE_LISTING,
    null,
    changes,
    ...([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ] as const),
    settledPrivacy,
  );
  return html.slice(html.indexOf('class="hero"'), html.indexOf("action-row"));
};

describe("sidepanel home hero", () => {
  test("home hero carries the value and 24h delta without redundant identity copy", () => {
    // The chart series is still accepted for the token-detail flow but the
    // home hero no longer renders a sparkline from it.
    const hero = heroOf([balance], { "0x00aa": 4 }, [1, 2, 3, 4]);
    expect(hero).not.toContain('class="hero-eyebrow"');
    expect(hero).not.toContain("Total balance");
    expect(hero).not.toContain('data-copy="');
    // 24h delta line: coloured magnitude + a muted "· 24h" window; +4% ⇒ up.
    expect(hero).toContain('class="hero-change"');
    expect(hero).toContain('class="hero-change-amt"');
    expect(hero).toContain("· 24h");
    // The portfolio area chart was removed — the hero has no sparkline markup.
    expect(hero).not.toContain("hero-spark");
    expect(hero).not.toContain("spark-line");
    expect(hero).not.toContain("7d ago");
  });

  test("home hero caption states the 24h figures are price moves", () => {
    const hero = heroOf([balance], { "0x00aa": 4 });

    // The hero names the figure a price move and carries no caption under it.
    expect(hero).toContain("Portfolio price · 4.00% · 24h");
    expect(hero).not.toContain("hero-note");
  });

  test("home hero omits the change line when there is no priced baseline", () => {
    // Prices exist so the hero renders its change region, but no balance is
    // priced, so portfolioDelta is null and the gate must suppress the line.
    // Removing the gate renders it (or throws on the null delta) here, which
    // the old empty-balances, empty-prices fixture could not detect.
    const hero = heroOf([], {});

    expect(hero).not.toContain("hero-note");
    expect(hero).not.toContain("Portfolio price");
  });
});
