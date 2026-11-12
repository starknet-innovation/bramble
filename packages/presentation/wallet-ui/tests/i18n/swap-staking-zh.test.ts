/**
 * The swap and staking screens render in Simplified Chinese when that is the
 * UI language: their own catalog sentences appear, and no English sentence
 * from the swap/staking catalog leaks into the markup. The swap confirm stage
 * is signing text, translated with the approvals, so it is set aside here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import { setUiLocale } from "../../src/i18n/locale";
import { uiCatalogs } from "../../src/i18n/messages";
import type { WalletStatus } from "../../src/popup/responses/responses";
import type { StakingRow } from "../../src/sidepanel/journeys/staking/staking-client";
import {
  STAKING_LOADING,
  type StakingState,
} from "../../src/sidepanel/journeys/staking/staking-directory-client";
import { homeTabPanels, stakedSummary } from "../../src/sidepanel/journeys/staking/staking-home";
import { exitWindowText, stakingFlow } from "../../src/sidepanel/journeys/staking/staking-views";
import type { SwapFigures } from "../../src/sidepanel/journeys/swap/swap-receipt";
import {
  paintSwapConfirm,
  paintSwapMeta,
  paintSwapReceipt,
  swapReceiptFor,
  swapUnknownReceipt,
} from "../../src/sidepanel/journeys/swap/swap-receipt";
import { swapFlow } from "../../src/sidepanel/journeys/swap/swap-views";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
afterEach(() => setUiLocale("en"));

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: account.networkId,
  networks: [{ id: account.networkId, name: "Starknet Mainnet" }],
  ready: true,
};

const STAKER = `0x5a2${"0".repeat(56)}beef`;
const ROW: StakingRow = {
  accepting: true,
  commission: "10%",
  delegated: "1000",
  rewardSymbol: "STRK",
  rewardsTo: `0x7${"0".repeat(62)}`,
  staked: "250",
  staker: STAKER,
  state: "exit-pending",
  symbol: "STRK",
  tokenId: "SN_MAIN:strk",
  unclaimed: "3",
  unpoolAmount: "50",
  unpoolTime: 1_790_000_000,
};

const englishSentences = Object.entries(uiCatalogs.en)
  .filter(([key, text]) => /^(?:swap|staking)\./u.test(key) && !text.includes("{"))
  .map(([, text]) => text)
  .filter((text) => text.length > 6);

// Visible and accessible text of the markup, without the swap confirm stage.
const textOf = (html: string): string => {
  const host = document.createElement("div");
  host.innerHTML = html;
  host.querySelector("#swap-confirm")?.remove();
  const labels = [...host.querySelectorAll("[aria-label], [placeholder]")].map(
    (node) => `${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("placeholder") ?? ""}`,
  );
  return `${host.textContent ?? ""} ${labels.join(" ")}`;
};

const leaks = (text: string): readonly string[] =>
  englishSentences.filter((sentence) => text.includes(sentence));

const directoryState: StakingState = {
  ...STAKING_LOADING,
  directory: {
    entries: [
      {
        commission: null,
        name: null,
        pools: [{ delegated: null, symbol: "STRK" }],
        staker: STAKER,
        uptime: "99%",
        website: null,
      },
    ],
    moreError: null,
    nextCursor: "next",
  },
  positions: { complete: false, rows: [ROW] },
} as unknown as StakingState;

describe("swap in Simplified Chinese", () => {
  test("the quote and outcome stages carry no English", () => {
    setUiLocale("zh-Hans");
    const text = textOf(swapFlow(status, account));
    expect(text).toContain("兑换");
    expect(text).toContain("卖出数量");
    expect(text).toContain("检查兑换");
    expect(text).toContain("兑换完成");
    expect(leaks(text)).toEqual([]);
  });

  test("the leak check sees English when the UI is English", () => {
    expect(leaks(textOf(swapFlow(status, account))).length).toBeGreaterThan(0);
  });
});

describe("swap quote line and outcome in Simplified Chinese", () => {
  const STRK = {
    address: "0x4718",
    decimals: 18,
    id: "SN_MAIN:strk",
    name: "Starknet Token",
    networkId: "SN_MAIN",
    symbol: "STRK",
  } as const;
  const QUOTE = {
    buyAmount: "2",
    buyAmountInUsd: 1,
    gasFeesInUsd: 0.02,
    quoteId: "q",
    sellAmount: "1",
    sellAmountInUsd: 1,
  };
  const figures = (overrides: Partial<SwapFigures>): SwapFigures => ({
    buyToken: { ...STRK, id: "SN_MAIN:eth", symbol: "ETH" },
    highRisk: false,
    insufficient: false,
    lossPercent: 0,
    sellBalance: null,
    sellToken: STRK,
    valueDelta: null,
    ...overrides,
  });
  const mounted = (): Element => {
    const host = document.createElement("div");
    host.innerHTML = swapFlow(status, account);
    return host;
  };
  const label = (root: Element): string =>
    root.querySelector("#swap-review-label")?.textContent ?? "";

  test("the review control, fee and slippage warning", () => {
    setUiLocale("zh-Hans");
    const root = mounted();
    paintSwapMeta(root, figures({}), QUOTE, 1);
    expect(label(root)).toBe("检查兑换");
    expect(root.querySelector("#swap-gas")?.textContent).toBe("费用 ≈ $0.02");
    paintSwapMeta(root, figures({ insufficient: true }), QUOTE, 1);
    expect(label(root)).toBe("STRK 余额不足");
    paintSwapMeta(root, figures({ insufficient: true, sellToken: null }), QUOTE, 1);
    expect(label(root)).toBe("余额不足");
    paintSwapMeta(root, figures({ highRisk: true, lossPercent: 12.34 }), QUOTE, 1);
    expect(label(root)).toBe("仍然兑换（−12.3%）");
    expect(root.querySelector("#swap-warning")?.textContent).toBe("滑点风险高");
  });

  test("the English labels are unchanged", () => {
    const root = mounted();
    paintSwapMeta(root, figures({ highRisk: true, lossPercent: 12.34 }), QUOTE, 1);
    expect(label(root)).toBe("Swap anyway (−12.3%)");
    paintSwapMeta(root, figures({ insufficient: true, sellToken: null }), QUOTE, 1);
    expect(label(root)).toBe("Insufficient balance");
  });

  test("the outcome receipt states complete, submitted or unknown", () => {
    setUiLocale("zh-Hans");
    expect(swapReceiptFor(null, "1 STRK → ~2 ETH", "0xabc")).toEqual({
      hash: "0xabc",
      note: "尚未确认。可在“活动”中跟踪。",
      summary: "1 STRK → ~2 ETH",
      title: "兑换已提交",
    });
    const unknown = swapUnknownReceipt("reason", "1 STRK → ~2 ETH");
    expect(unknown.title).toBe("状态未知");
    const root = mounted();
    paintSwapReceipt(root, unknown, "SN_MAIN");
    expect(root.querySelector("#swap-success-title")?.textContent).toBe("状态未知");
    expect(root.querySelector("#swap-success-note")?.hasAttribute("hidden")).toBe(false);
  });
});

describe("the swap confirm stage", () => {
  test("renders in Chinese from the pinned review catalog; a flag without a reference stays as sent", () => {
    setUiLocale("zh-Hans");
    const host = document.createElement("div");
    host.innerHTML = swapFlow(status, account);
    paintSwapConfirm(host, {
      buyToken: { address: "0x2", symbol: "ETH" },
      lossPercent: 0,
      preparation: {
        flags: [{ code: "unknown-contract", message: "Unknown contract" }],
        id: "p",
        minBuyAmount: "1.9",
        reviewedFee: { overallFee: "1", unit: "FRI" },
      } as unknown as Parameters<typeof paintSwapConfirm>[1]["preparation"],
      quote: {
        buyAmount: "2",
        buyAmountInUsd: 1,
        gasFeesInUsd: 0,
        quoteId: "q",
        sellAmount: "1",
        sellAmountInUsd: 1,
      },
      sellToken: { address: "0x1", symbol: "STRK" },
      valueDelta: null,
    });
    const confirm = host.querySelector("#swap-confirm")?.textContent ?? "";
    expect(confirm).toContain("检查兑换");
    expect(confirm).toContain("你卖出");
    expect(confirm).toContain("最少收到");
    expect(confirm).toContain("1.9 ETH");
    // The flag carries no review reference, so its English is shown unchanged.
    expect(confirm).toContain("Unknown contract");
    expect(confirm).not.toContain("Review swap");
  });
});

describe("staking in Simplified Chinese", () => {
  test("the directory, Your stakes and a validator carry no English", () => {
    setUiLocale("zh-Hans");
    const directory = textOf(stakingFlow(status, account, directoryState));
    expect(directory).toContain("你的质押");
    expect(directory).toContain("未命名验证者");
    expect(directory).toContain("佣金 未知 · 30 天在线率 99%");
    expect(directory).toContain("STRK 委托量未知");
    expect(leaks(directory)).toEqual([]);

    const validator = textOf(
      stakingFlow(status, account, {
        ...STAKING_LOADING,
        selected: { name: null, staker: STAKER },
        validator: { exitWindowSeconds: 604_800, rows: [{ ...ROW, state: "staked" }] },
      }),
    );
    expect(validator).toContain("解除质押需要 7 天，等待期间没有奖励。");
    expect(validator).toContain("已质押 250 STRK");
    expect(validator).toContain("领取奖励");
    expect(leaks(validator)).toEqual([]);
  });

  test("Home's tabs and staked line follow the language", () => {
    setUiLocale("zh-Hans");
    const { bar, panels } = homeTabPanels("staking", "", directoryState, "");
    const text = textOf(bar + panels);
    expect(text).toContain("代币");
    expect(text).toContain("质押");
    expect(leaks(text)).toEqual([]);
    expect(
      stakedSummary(directoryState, [
        {
          address: "0x4718",
          decimals: 18,
          id: "SN_MAIN:strk",
          name: "Starknet Token",
          networkId: "SN_MAIN",
          symbol: "STRK",
        },
      ]),
    ).toBe("已质押 250 STRK");
  });

  test("durations read in Chinese and stay unchanged in English", () => {
    expect(exitWindowText(604_800)).toBe("7 days");
    expect(exitWindowText(3_600)).toBe("1 hour");
    setUiLocale("zh-Hans");
    expect(exitWindowText(604_800)).toBe("7 天");
    expect(exitWindowText(300)).toBe("5 分钟");
    expect(exitWindowText(42)).toBe("42 秒");
  });
});
