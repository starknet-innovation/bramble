/**
 * Token UI checks: home fiat totals with spam hidden, the tokens management
 * flow, and the token detail flow with a self-drawn sparkline.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@mc-wallet/settings/preferences";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { BalancesResponse, WalletStatus } from "../../../../src/popup/responses/responses";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SPOOF = "0x00abc0000000000000000000000000000000000000000000000000000000abc";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
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

const ethToken: TokenConfig = {
  address: ETH,
  decimals: 18,
  id: `SN_MAIN:ETH:${ETH}`,
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};
const spoofToken: TokenConfig = {
  address: SPOOF,
  decimals: 6,
  id: `SN_MAIN:USDC:${SPOOF}`,
  name: "Fake USD",
  networkId: "SN_MAIN",
  symbol: "USDC",
};

const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  hiddenTokens: [],
  schemaVersion: 1,
  tokens: [ethToken, spoofToken],
};

const balances: BalancesResponse["balances"] = [
  {
    address: ETH,
    balance: "1000000000000000000",
    decimals: 18,
    formatted: "1.0",
    id: ethToken.id,
    name: "Ether",
    networkId: "SN_MAIN",
    symbol: "ETH",
  },
  {
    address: SPOOF,
    balance: "1000000",
    decimals: 6,
    formatted: "1.0",
    id: spoofToken.id,
    name: "Fake USD",
    networkId: "SN_MAIN",
    symbol: "USDC",
  },
];
const prices = { [ETH]: 2000, [SPOOF]: 1 };

describe("token views", () => {
  test("home shows fiat totals, hides spam, and links to the tokens flow", () => {
    const html = dashboard("home", status, [], preferences, { balances }, null, [], [], prices);

    expect(html).toContain('class="hero-total"');
    expect(html).toContain('data-live-value="2000">$2,000.00</p>');
    expect(html).toContain(">1.00</p>");
    expect(html).not.toContain("Fake USD");
    expect(html).toContain("1 hidden");
    expect(html).toContain('data-view="tokens"');
    expect(html).toMatch(/data-token-detail="SN_MAIN:ETH:/);
  });

  test("tokens flow lists focused add/detect routes and per-token controls", () => {
    const html = dashboard("tokens", status, [], preferences, { balances }, null, [], [], prices);

    expect(html).toContain('data-view="token-add"');
    expect(html).toContain('data-view="token-discover"');
    expect(html).toMatch(new RegExp(`data-token-toggle="${ethToken.id}"`));
    expect(html).toContain("Likely spam");
    expect(html).not.toContain("wallet-dock");
    expect(dashboard("token-add", status, [], preferences, { balances: [] })).toContain(
      'id="token-add-form"',
    );
    expect(dashboard("token-discover", status, [], preferences, { balances: [] })).toContain(
      'id="detect-tokens"',
    );
  });

  test("token detail flow draws price, sparkline, and contract facts", () => {
    const html = dashboard(
      "token-detail",
      status,
      [],
      preferences,
      { balances },
      null,
      [],
      [],
      prices,
      [1, 2, 3],
      ethToken.id,
    );

    expect(html).toContain("$3.00");
    expect(html).toContain('<polyline points="0,32 50,16 100,0" />');
    expect(html).toContain(ETH);
    expect(html).toContain("Decimals");
    expect(html).not.toContain("wallet-dock");
  });
});
