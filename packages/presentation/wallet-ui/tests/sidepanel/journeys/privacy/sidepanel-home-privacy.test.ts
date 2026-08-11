/**
 * Unified balances: the hero and token list total public and private amounts
 * together, and each asset row discloses its public/private split. Missing
 * private data degrades to public-only totals instead of hiding the portfolio.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@mc-wallet/settings/preferences";
import { account } from "@mc-wallet/testkit/sidepanel";
import { STRK_TOKEN_ADDRESS } from "@mc-wallet/wallet-model/networks";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import {
  homeTabs,
  unifiedHomeBalances,
} from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";

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
        poolFeeFri: "0x1",
        relayConfigured: true,
        registration: "registered",
        privateBalances: "ready",
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

describe("unified portfolio scope", () => {
  test("lists STRK first, whatever order the tracked tokens are stored in", () => {
    // STRK pays every fee, so it leads every token list; the stored order
    // (ETH first by default) must not decide what the user sees first.
    const strkToken: TokenConfig = {
      address: STRK_TOKEN_ADDRESS,
      decimals: 18,
      id: `SN_MAIN:STRK:${STRK_TOKEN_ADDRESS}`,
      name: "Starknet Token",
      networkId: "SN_MAIN",
      symbol: "STRK",
    };
    const strk: TokenBalance = {
      ...strkToken,
      balance: "0x1",
      formatted: "0.000000000000000001",
    };
    const tracked: WalletPreferences = {
      ...preferences,
      tokens: [...preferences.tokens, strkToken],
    };
    const ordered = unifiedHomeBalances(
      { balances: [publicBalance, strk] },
      { error: null, loading: false, value: null },
      tracked,
    );

    expect(ordered[0]?.symbol).toBe("STRK");
    expect(ordered.map((entry) => entry.symbol)).toContain("ETH");
  });

  test("the hero totals public and private balances together", () => {
    // 1.25 public + 0.5 private ETH at $2,000 = $3,500.
    const html = privateDashboard(privateState());
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("home-actions"));

    expect(hero).toContain("$3,500.00");
    expect(hero).toContain('data-live-key="portfolio-total"');
    expect(hero).toContain("Includes shielded balances");
    // The old toggle and its copy are gone.
    expect(html).not.toContain("data-privacy-toggle");
    expect(html).not.toContain("Display shielded balances");
    expect(html).not.toContain("Private portfolio");
  });

  test("asset rows disclose the public/private split with the asset link", () => {
    const html = privateDashboard(privateState());
    const row = html.slice(html.indexOf("token-unified"));

    // Summary shows the combined amount; the dropdown shows the split.
    expect(row).toContain(">1.75<");
    expect(row).toContain("Public balance");
    expect(row).toContain("1.25 ETH");
    expect(row).toContain("Private balance");
    expect(row).toContain("0.50 ETH");
    expect(row).toContain(`data-token-detail="${token.id}"`);
    expect(row).toContain("See more about ETH");
    // The row discloses the split and links to the asset; shielding is offered on
    // the asset screen, as two explicit directions, rather than here.
    expect(row).not.toContain("Shield / Unshield ETH");
    expect(row).not.toContain("data-privacy-open");
    // The retired +/- stepper leaves nothing behind.
    expect(row).not.toContain("data-shield-step");
    expect(row).not.toContain("shield-confirm");
  });

  // The reported bug's visible half: an account re-added after clearing the
  // extension is registered on chain but holds no key here. Offering registration
  // named an action the pool refuses; the remaining step is the ceremony.
  test("a registered account with no local viewing key is offered the ceremony", () => {
    const html = homeTabs({ balances: [publicBalance] }, preferences, {}, {}, "usd", status, [], {
      error: null,
      loading: false,
      value: {
        accountId: account.id,
        balances: [],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        privateBalances: "setup-required",
        registration: "registered",
        relayConfigured: true,
      },
    });

    expect(html).toContain('title="Generate your viewing key to read private balances"');
    expect(html).toContain("Generate your viewing key");
    expect(html).not.toContain("Register to start shielding");
  });

  test("no viewing key and no registration still reads as registering", () => {
    const html = homeTabs({ balances: [publicBalance] }, preferences, {}, {}, "usd", status, [], {
      error: null,
      loading: false,
      value: {
        accountId: account.id,
        balances: [],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        privateBalances: "setup-required",
        registration: "unregistered",
        relayConfigured: true,
      },
    });

    // The ceremony is a step inside that journey, not a separate destination.
    expect(html).toContain('title="Register to start shielding"');
    expect(html).not.toContain("Generate your viewing key");
  });

  test("an unregistered account greys the private line into the activation entry", () => {
    const html = homeTabs({ balances: [publicBalance] }, preferences, {}, {}, "usd", status, [], {
      error: null,
      loading: false,
      value: {
        accountId: account.id,
        balances: [],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        relayConfigured: true,
        registration: "unregistered",
        privateBalances: "ready",
      },
    });

    expect(html).toContain(`data-privacy-register="${token.id}"`);
    expect(html).toContain('title="Register to start shielding"');
    // Combined amount degrades to public-only while unregistered, and there is
    // nothing to shield yet, so no shield/unshield entry is offered.
    expect(html).toContain(">1.25<");
    expect(html).not.toContain("Shield / Unshield");
  });

  test("a pending registration reports itself instead of offering to register again", () => {
    const html = homeTabs({ balances: [publicBalance] }, preferences, {}, {}, "usd", status, [], {
      error: null,
      loading: false,
      value: {
        accountId: account.id,
        balances: [],
        networkId: "SN_MAIN",
        poolFeeFri: "0x1",
        relayConfigured: true,
        registration: "pending",
        privateBalances: "ready",
      },
    });

    expect(html).toContain("Registration pending…");
    // The activation entry is what would broadcast a second registration, so it
    // must be absent for as long as the first one is settling.
    expect(html).not.toContain("data-privacy-register");
    expect(html).not.toContain("Register to start shielding");
    // Nor can anything be shielded until the pool can see the registration.
    expect(html).not.toContain("Shield / Unshield");
  });

  test("pending discovery marks the portfolio total incomplete", () => {
    const html = privateDashboard(privateState(true));
    const hero = html.slice(html.indexOf('class="hero"'), html.indexOf("home-actions"));

    expect(hero).toContain("Public balances shown; private balances are still refreshing");
    expect(hero).toContain("$2,500.00");
    expect(hero).toContain('data-total-complete="false"');
    expect(html).toContain("Discovering…");
  });

  test("unified rows preserve the hidden-token filter", () => {
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
  });
});
