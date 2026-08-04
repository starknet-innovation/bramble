/**
 * The dashboard view switch renders the token-detail flow when the selected
 * token id resolves to a tracked token on the active network — the arm that
 * looks the token up and threads its chart-derived price into tokenDetailFlow.
 */
import { describe, expect, test } from "bun:test";
import type { TokenBalance, WalletStatus } from "../../src/popup/responses";
import type { PrivacyDisclosureState } from "../../src/sidepanel/privacy-model";
import { tokenDetailFlow } from "../../src/sidepanel/token-flows";
import { dashboard } from "../../src/sidepanel/views";
import type { TokenConfig, WalletPreferences } from "../../src/storage/preferences-store";
import { account } from "../support/sidepanel-fixtures";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const token: TokenConfig = {
  address: ETH,
  decimals: 18,
  id: `SN_MAIN:ETH:${ETH}`,
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
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

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [token],
};

const balance: TokenBalance = {
  ...token,
  balance: "1250000000000000000",
  formatted: "1.25",
};

describe("dashboard token-detail arm", () => {
  test("renders the token-detail flow for a resolvable selected token id", () => {
    const html = dashboard(
      "token-detail",
      status,
      [],
      preferences,
      { balances: [] },
      null,
      [],
      [],
      { [ETH]: 1234 },
      [10, 20, 30],
      token.id,
    );

    expect(html).toContain('id="wallet-screen-token-detail"');
    expect(html).toContain("Ether");
  });

  test("a token id that does not resolve does not render the token-detail screen", () => {
    const html = dashboard(
      "token-detail",
      status,
      [],
      preferences,
      { balances: [] },
      null,
      [],
      [],
      {},
      [],
      "SN_MAIN:UNKNOWN:0xdead",
    );

    expect(html).not.toContain('id="wallet-screen-token-detail"');
  });

  test("private entry uses the public balance hierarchy with a restrained marker", () => {
    const privacy: PrivacyDisclosureState = {
      error: null,
      loading: false,
      value: {
        accountId: account.id,
        balances: [
          {
            balance: "0x6f05b59d3b20000",
            formatted: "0.5",
            symbol: token.symbol,
            token: token.address,
            tokenId: token.id,
          },
        ],
        networkId: "SN_MAIN",
        registration: "registered",
      },
    };

    const html = tokenDetailFlow(status, token, balance, [10, 20, 30], 2_000, "usd", privacy);

    expect(html).toContain('class="private-balance-summary"');
    expect(html).toContain('class="private-balance-label"');
    expect(html).toContain("0.5 ETH");
    expect(html).toContain("$1,000.00");
    expect(html).not.toContain("Discovered from shielded notes");
  });

  test("an unregistered account sees the greyed register hint instead of a split", () => {
    const privacy: PrivacyDisclosureState = {
      error: null,
      loading: false,
      value: {
        accountId: account.id,
        balances: [],
        networkId: "SN_MAIN",
        registration: "unregistered",
      },
    };

    const html = tokenDetailFlow(status, token, balance, [10, 20, 30], 2_000, "usd", privacy);

    expect(html).toContain('title="Register to start shielding"');
    expect(html).toContain("Go private");
    expect(html).not.toContain('class="private-balance-summary"\n');
  });
});
