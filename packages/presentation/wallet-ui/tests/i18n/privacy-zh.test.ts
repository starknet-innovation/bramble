/**
 * The privacy journey in Simplified Chinese: the waits, outcomes,
 * prerequisite screens, progress lines, shadow accounts and STRK20 service
 * settings render from the catalog, and no English privacy sentence leaks
 * through. The activation review is signing text and is not rendered here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import { setUiLocale } from "../../src/i18n/locale";
import { privacyMessages } from "../../src/i18n/messages/privacy";
import type { WalletStatus } from "../../src/popup/responses/responses";
import type {
  PrivacyBlockerKind,
  PrivacyJourneyState,
} from "../../src/sidepanel/journeys/privacy/privacy-model";
import type { PrivacyPreparation } from "../../src/sidepanel/journeys/privacy/privacy-runtime";
import { strk20ServicesForm } from "../../src/sidepanel/journeys/privacy/privacy-settings-view";
import {
  privacyFlow,
  privacyLivenessText,
} from "../../src/sidepanel/journeys/privacy/privacy-views";
import { shadowAccountsFlow } from "../../src/sidepanel/journeys/privacy/shadow-accounts-view";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
afterEach(() => setUiLocale("en"));

const token: TokenConfig = {
  address: "0x456",
  decimals: 18,
  id: "SN_MAIN:ETH:0x456",
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
const digest = `sha256:${"a".repeat(64)}`;
const preparation: PrivacyPreparation = {
  id: digest,
  kind: "register",
  payloadDigest: digest,
  poolAddress: "0x12345678901234567890",
  route: "public-account",
  summaries: ["Register viewing-key commitment"],
  symbol: "ETH",
  tokenId: token.id,
};

const BLOCKERS: readonly Exclude<PrivacyBlockerKind, "other-wallet">[] = [
  "deploy",
  "fund",
  "ledger",
  "network",
  "pending",
  "service",
];

const journeys: readonly PrivacyJourneyState[] = [
  { stage: "idle" },
  { progress: null, stage: "preparing", step: "discovering", tokenId: token.id },
  {
    progress: { attempt: 2, attempts: 3, elapsedMs: 72_000, phase: "proving" },
    stage: "preparing",
    step: "proving",
    tokenId: token.id,
  },
  { kind: "register", preparation, stage: "working", tokenId: token.id },
  { hash: "0x1", kind: "register", stage: "success", symbol: "ETH", tokenId: token.id },
  {
    error: "失败原因",
    errorDetails: "详情",
    severity: "danger",
    stage: "failure",
    tokenId: token.id,
  },
  { error: "未知", errorDetails: "详情", severity: "warning", stage: "failure", tokenId: token.id },
  ...BLOCKERS.map(
    (kind): PrivacyJourneyState => ({
      blocker: { kind, message: "原因" },
      stage: "blocked",
      tokenId: token.id,
    }),
  ),
];

// Visible text plus every accessible name, so a label hidden in an attribute
// counts as rendered.
const rendered = (html: string): string => {
  const host = document.createElement("div");
  host.innerHTML = html;
  const labels = [...host.querySelectorAll("[aria-label]")].map(
    (node) => node.getAttribute("aria-label") ?? "",
  );
  return [host.textContent ?? "", ...labels].join("\n");
};

// English privacy sentences with no facts: none may appear in a Chinese render.
const englishSentences = Object.values(privacyMessages.en).filter(
  (text) => !text.includes("{") && text.length > 6,
);

const allRendered = (): string =>
  [
    ...journeys.map((journey) => rendered(privacyFlow(status, preferences, journey))),
    rendered(
      privacyFlow(
        status,
        preferences,
        { blocker: { kind: "fund", message: "原因" }, stage: "blocked", tokenId: token.id },
        { error: null, loading: false, value: { poolFeeFri: "0x2386f26fc10000" } as never },
      ),
    ),
    rendered(shadowAccountsFlow(status)),
    rendered(strk20ServicesForm("Starknet Mainnet", null)),
  ].join("\n");

describe("privacy in Simplified Chinese", () => {
  test("renders the waits, outcomes and prerequisite screens from the catalog", () => {
    setUiLocale("zh-Hans");
    const text = allRendered();
    for (const expected of [
      "正在检查隐私余额",
      "正在准备启用隐私余额",
      "正在启用隐私余额",
      "已注册",
      "状态未知",
      "隐私交易未完成",
      "先部署此账户",
      "Ledger 账户不可用",
      "注册正在处理中",
      "返回钱包",
      "影子账户",
      "保存隐私服务",
    ]) {
      expect(text).toContain(expected);
    }
  });

  test("no English privacy sentence leaks into a Chinese render", () => {
    setUiLocale("zh-Hans");
    const text = allRendered();
    expect(englishSentences.filter((sentence) => text.includes(sentence))).toEqual([]);
  });

  test("the leak check sees English when the UI is English", () => {
    const text = allRendered();
    expect(englishSentences.filter((sentence) => text.includes(sentence)).length).toBeGreaterThan(
      20,
    );
  });

  test("the progress line keeps its facts and reorders around them", () => {
    const progress = { attempt: 2, attempts: 3, elapsedMs: 72_000, phase: "proving" } as const;
    expect(privacyLivenessText(progress, "Hint")).toBe(
      "Proving (attempt 2 of 3) · 1 min 12 s. Hint",
    );
    setUiLocale("zh-Hans");
    expect(privacyLivenessText(progress, "提示")).toBe(
      "正在生成证明（第 2 次，共 3 次）· 1 分 12 秒。提示",
    );
    expect(privacyLivenessText({ elapsedMs: 5_000 }, "提示")).toBe("正在启动 · 5 秒。提示");
  });

  test("facts stay escaped", () => {
    setUiLocale("zh-Hans");
    const html = privacyFlow(status, preferences, {
      hash: "0x1",
      kind: "register",
      stage: "success",
      symbol: "<b>X</b>",
      tokenId: token.id,
    });
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).not.toContain("<b>X</b>");
  });
});
