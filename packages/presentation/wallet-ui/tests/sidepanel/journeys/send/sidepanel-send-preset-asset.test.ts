/**
 * Opening Send on a chosen asset. The token detail screen names the asset and
 * nothing else, so the flow still opens on the recipient step — unlike a shield
 * shortcut, which names a recipient too and opens further along.
 */
import { describe, expect, test } from "bun:test";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { TokenBalance, WalletStatus } from "../../../../src/popup/responses/responses";
import { sendFlow } from "../../../../src/sidepanel/journeys/send/send-views";
import { transferPreferences as preferences } from "../../../support/transfer-ui-harness";

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

const ETH_ID = preferences.tokens[0]?.id ?? "";
const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const STRK_ID = `SN_MAIN:STRK:${STRK_ADDRESS}`;

const withStrk: WalletPreferences = {
  ...preferences,
  tokens: [
    ...preferences.tokens,
    {
      address: STRK_ADDRESS,
      decimals: 18,
      id: STRK_ID,
      name: "Starknet Token",
      networkId: "SN_MAIN",
      symbol: "STRK",
    },
  ],
};

const balances: readonly TokenBalance[] = withStrk.tokens.map(
  (token): TokenBalance => ({ ...token, balance: "1000000000000000000", formatted: "1" }),
);

const selectedSymbol = (html: string): string =>
  html.match(/id="send-selected-token-symbol">([^<]*)</)?.[1] ?? "";

describe("opening Send on a chosen asset", () => {
  test("opens on that asset, still on the recipient step", () => {
    const html = sendFlow(status, account, withStrk, balances, {}, {}, "usd", [], null, STRK_ID);

    expect(selectedSymbol(html)).toBe("STRK");
    // No recipient was carried over, so the first step is still the chooser.
    expect(html).toMatch(/id="send-recipient-stage"(?![^>]*hidden)/);
    expect(html).toContain('data-send-intent="false"');
  });

  test("an asset that is no longer tracked opens exactly as none would", () => {
    // Untracking a token while navigating must not leave the screen unsendable,
    // and must not pick some third thing: it is the same screen as no choice.
    const gone = sendFlow(
      status,
      account,
      withStrk,
      balances,
      {},
      {},
      "usd",
      [],
      null,
      "SN_MAIN:GONE:0x9",
    );
    const none = sendFlow(status, account, withStrk, balances, {}, {}, "usd", [], null, null);

    expect(selectedSymbol(gone)).toBe(selectedSymbol(none));
    expect(selectedSymbol(gone)).not.toBe("");
  });

  test("choosing an asset changes which one opens", () => {
    const none = sendFlow(status, account, withStrk, balances, {}, {}, "usd", [], null, null);
    const eth = sendFlow(status, account, withStrk, balances, {}, {}, "usd", [], null, ETH_ID);

    expect(selectedSymbol(eth)).toBe("ETH");
    expect(selectedSymbol(none)).not.toBe(selectedSymbol(eth));
  });
});
