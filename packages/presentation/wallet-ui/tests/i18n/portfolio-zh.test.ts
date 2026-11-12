/**
 * The portfolio screens (Home tokens, Activity, token management and detail,
 * allowances, signed-for-relay rows, and the NFT gallery) render in Simplified
 * Chinese when that is the UI language: their catalog sentences appear, no
 * English sentence from the portfolio, activity or collectibles catalogs leaks,
 * and the Activity filter keeps matching on the English verb it records.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { escapeHtml } from "@bramble/core/html";
import type { TokenConfig } from "@bramble/settings/preferences";
import { account, preferences } from "@bramble/testkit/sidepanel";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { RelaySignature } from "@bramble/transactions/relay-signatures";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { setUiLocale } from "../../src/i18n/locale";
import { uiCatalogs } from "../../src/i18n/messages";
import type { TokenBalance, WalletStatus } from "../../src/popup/responses/responses";
import {
  nftGalleryFlow,
  nftHiddenFlow,
  nftWatchFlow,
} from "../../src/sidepanel/journeys/collectibles/nft-views";
import { activityPartySummaryParts } from "../../src/sidepanel/journeys/portfolio/activity-filter";
import { activityScreen } from "../../src/sidepanel/journeys/portfolio/activity-views";
import { allowancesFlow } from "../../src/sidepanel/journeys/portfolio/allowance-views";
import { homeTabs } from "../../src/sidepanel/journeys/portfolio/home-tabs";
import { relaySection } from "../../src/sidepanel/journeys/portfolio/relay-rows";
import { tokenCatalogFlow } from "../../src/sidepanel/journeys/portfolio/token-catalog-view";
import {
  tokenAddFlow,
  tokenDetailFlow,
  tokenDiscoverFlow,
  tokensFlow,
} from "../../src/sidepanel/journeys/portfolio/token-flows";

afterEach(() => setUiLocale("en"));

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Sepolia",
  networkId: account.networkId,
  networks: [{ id: account.networkId, name: "Starknet Sepolia" }],
  ready: true,
};

const strk: TokenConfig = {
  address: STRK_TOKEN_ADDRESS,
  decimals: 18,
  id: `${account.networkId}:STRK:${STRK_TOKEN_ADDRESS}`,
  name: "Starknet Token",
  networkId: account.networkId,
  symbol: "STRK",
};
const balance: TokenBalance = { ...strk, balance: "0xde0b6b3a7640000", formatted: "1" };
const prefs = { ...preferences, tokens: [strk] };

const sent: ActivityEntry = {
  accountId: account.id,
  amount: "1",
  counterparty: "0x0123456789abcdef",
  direction: "out",
  hash: "0x123",
  kind: "transfer",
  networkId: account.networkId,
  origin: "wallet",
  status: "pending",
  submittedAt: 1752501900000,
  summary: "Sent 1 STRK",
  token: "STRK",
  tokenAddress: STRK_TOKEN_ADDRESS,
};

const relay: RelaySignature = {
  accountId: account.id,
  callCount: 2,
  checkable: true,
  executeBefore: 1_900_000_000,
  messageHash: "0xabc",
  networkId: account.networkId,
  nonce: "0x2a",
  origin: "https://app.example",
  revision: "2",
  signedAt: 1_800_000_000_000,
  status: "signed",
} as RelaySignature;

const AREAS = ["portfolio.", "collectibles."];
// Placeholder-free English sentences long enough not to collide with markup,
// and different from their Chinese (a few, like "NFT", read the same).
const englishSentences = Object.entries(uiCatalogs.en)
  .filter(([key, text]) => AREAS.some((area) => key.startsWith(area)) && !text.includes("{"))
  .filter(([key, text]) => text !== (uiCatalogs["zh-Hans"] as Record<string, string>)[key])
  .map(([, text]) => text)
  // Lowercase single words (status values like "pending") double as class
  // names and data values in the markup, so only sentences and capitalised
  // words are checked.
  .filter((text) => text.length > 6 && (/\s/.test(text) || /^[A-Z]/.test(text)));

const leaks = (html: string): readonly string[] =>
  englishSentences.filter((text) => html.includes(text) || html.includes(escapeHtml(text)));

const screens = (): Readonly<Record<string, string>> => ({
  activity: activityScreen([], status, [sent], false, null, undefined, null, [], [relay]),
  activityEmpty: activityScreen([], status, [], true),
  allowances: allowancesFlow(
    status,
    account,
    {
      entries: [
        {
          accountId: account.id,
          amount: `0x${"f".repeat(64)}`,
          id: `${account.id}:0x123:0xabc`,
          networkId: account.networkId,
          source: "external",
          spender: "0xabc",
          token: "0x123",
        },
      ],
      notices: ["scan-incomplete"],
      unavailable: false,
    },
    prefs,
  ),
  catalog: tokenCatalogFlow(status),
  home: homeTabs({ balances: [balance] }, prefs, {}, {}, "usd"),
  homeEmpty: homeTabs({ balances: [] }, prefs, {}, {}, "usd"),
  nftHidden: nftHiddenFlow(status, prefs, account),
  nftWatch: nftWatchFlow(status, account),
  nfts: nftGalleryFlow(status, account, prefs, [], "unavailable"),
  relay: relaySection([relay]),
  tokenAdd: tokenAddFlow(status),
  tokenDetail: tokenDetailFlow(status, strk, balance, [], null, "usd"),
  tokenDiscover: tokenDiscoverFlow(status),
  tokens: tokensFlow(status, prefs, [balance], {}, "usd"),
});

describe("portfolio in Simplified Chinese", () => {
  test("no English portfolio, activity or NFT sentence reaches these screens", () => {
    setUiLocale("zh-Hans");
    for (const [name, html] of Object.entries(screens())) {
      expect(leaks(html), name).toEqual([]);
    }
  });

  test("the screens carry their Chinese copy", () => {
    setUiLocale("zh-Hans");
    const views = screens();
    expect(views["home"]).toContain("管理代币");
    expect(views["homeEmpty"]).toContain("还没有跟踪的余额");
    expect(views["activity"]).toContain("已发送 1 STRK");
    expect(views["activity"]).toContain("待处理");
    expect(views["activity"]).toContain("已签名待中继");
    expect(views["activityEmpty"]).toContain("无法加载链上历史");
    expect(views["allowances"]).toContain("无限额");
    expect(views["allowances"]).toContain("此列表可能不完整");
    expect(views["tokens"]).toContain("按合约添加");
    expect(views["tokenDetail"]).toContain("你的余额");
    expect(views["nfts"]).toContain("无法加载 NFT 列表");
  });

  test("the Activity filter still keys on the recorded English verb", () => {
    setUiLocale("zh-Hans");
    const html = screens()["activity"] ?? "";
    expect(html).toContain('data-activity-action="Sent"');
    expect(html).toContain('<option value="Sent"');
    expect(html).toContain(">已发送</option>");
  });

  test("the counterparty summary reads in Chinese", () => {
    setUiLocale("zh-Hans");
    const parts = activityPartySummaryParts({
      count: 2,
      firstAt: Date.UTC(2026, 8, 1),
      label: "Alice",
      lastAt: Date.UTC(2026, 8, 2),
      totals: [{ received: "0", sent: "3", symbol: "STRK" }],
    });
    expect(parts.body).toBe("2 笔交易 · 已发送 3 STRK · 2026年9月1日 至 2026年9月2日");
  });

  test("the leak check would catch English", () => {
    setUiLocale("en");
    expect(leaks(screens()["tokens"] ?? "")).toContain("Add by contract");
  });
});
