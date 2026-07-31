/**
 * Private mode switches the whole portfolio scope atomically: the hero and
 * token list must never mix public and private balance domains.
 */
import { describe, expect, test } from "bun:test";
import type { TokenBalance, WalletStatus } from "../../src/popup/responses";
import { homeTabs } from "../../src/sidepanel/home-tabs";
import type { PrivacyDisclosureState } from "../../src/sidepanel/privacy-model";
import { dashboard } from "../../src/sidepanel/views";
import type { TokenConfig, WalletPreferences } from "../../src/storage/preferences-store";
import { account } from "../support/sidepanel-fixtures";

const token: TokenConfig = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
  id: "SN_MAIN:ETH:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [token],
};
const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};
const publicBalance: TokenBalance = {
  ...token,
  balance: "1250000000000000000",
  formatted: "1.25",
};
const privateState = (loading = false): PrivacyDisclosureState => ({
  enabled: true,
  error: null,
  loading,
  value: loading
    ? null
    : {
        accountId: account.id,
        balances: [
          {
            balance: "0x6f05b59d3b20000",
            formatted: "0.5",
            symbol: "ETH",
            token: token.address,
            tokenId: token.id,
          },
        ],
        networkId: "SN_MAIN",
        registration: "registered",
      },
});

const privateDashboard = (privacy: PrivacyDisclosureState): string =>
  dashboard(
    "home",
    status,
    [],
    preferences,
    { balances: [publicBalance] },
    true,
    [],
    [],
    { [token.address]: 2_000 },
    [],
    null,
    [],
    null,
    { [token.address]: 5 },
    [],
    [],
    null,
    null,
    null,
    null,
    false,
    null,
    [],
    null,
    null,
    false,
    [],
    false,
    null,
    { balances: [] },
    null,
    [],
    null,
    privacy,
  );

describe("private portfolio scope", () => {
  test("private mode replaces the public hero total and removes public 24h change", () => {
    const html = privateDashboard(privateState());
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("home-actions"));

    expect(hero).toContain("$1,000.00");
    expect(hero).not.toContain("$2,500.00");
    expect(hero).toContain("Private portfolio");
    expect(hero).not.toContain("24h");
    expect(html).toContain('class="token-open"');
    expect(html).toContain('class="private-balance-mark" aria-label="Private balance"');
    expect(html).toContain('class="token-amount"');
  });

  test("private discovery clears the previous public hero instead of leaking stale state", () => {
    const html = privateDashboard(privateState(true));
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("home-actions"));

    expect(hero).toContain('data-live-key="private-portfolio-total"');
    expect(hero).toContain('data-live-value="unknown">—');
    expect(hero).not.toContain("$2,500.00");
  });

  test("private mode preserves the hidden-token filter", () => {
    const hiddenPreferences: WalletPreferences = {
      ...preferences,
      hiddenTokens: [token.id],
    };
    const html = homeTabs(
      { balances: [publicBalance] },
      hiddenPreferences,
      { [token.address]: 2_000 },
      {},
      "usd",
      status,
      [],
      privateState(),
    );

    expect(html).not.toContain(`data-token-detail="${token.id}"`);
    expect(html).toContain("No private balances yet");
  });
});
