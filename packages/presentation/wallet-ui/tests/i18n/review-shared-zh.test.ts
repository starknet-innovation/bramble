/**
 * Signing screens in Simplified Chinese: every approval card kind, the fee
 * section variants, the outcome receipt and the Ledger signing takeover render
 * the wallet's own words in Chinese, leak no English sentence from the review
 * catalogs, and keep every fact (addresses, fees, hashes, counts) verbatim.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { setUiLocale } from "../../src/i18n/locale";
import { reviewApprovalMessages } from "../../src/i18n/messages/review-approvals";
import { reviewDetailMessages } from "../../src/i18n/messages/review-details";
import { reviewFeeMessages } from "../../src/i18n/messages/review-fees";
import { reviewSignMessages } from "../../src/i18n/messages/review-sign";
import type { PendingApproval, WalletStatus } from "../../src/popup/responses/responses";
import { approvalCard } from "../../src/sidepanel/journeys/approvals/approval-cards";
import { approvalTakeover } from "../../src/sidepanel/journeys/approvals/approval-screen";
import { ledgerSignScreen } from "../../src/sidepanel/journeys/ledger/sign-views";
import { confirmationOutcome } from "../../src/sidepanel/shared/confirm-submitted";
import { outcomeReceiptSection } from "../../src/sidepanel/shared/outcome-receipt";
import { reviewFeeSection } from "../../src/sidepanel/shared/review-render";
import { signRequestView } from "../../src/sidepanel/shared/sign-request";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
afterEach(() => setUiLocale("en"));

const ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const account = {
  accountContractType: "openzeppelin" as const,
  address: ADDRESS,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: `SN_MAIN:${ADDRESS}`,
  networkId: "SN_MAIN" as const,
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
const ID = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
const ORIGIN = "https://dapp.example";
const DIGEST = `sha256:${"a".repeat(64)}`;
const context = {
  accountId: account.id,
  chainId: "0x534e5f4d41494e",
  networkId: "SN_MAIN" as const,
  payloadDigest: DIGEST,
};

// Every English sentence the review catalogs own, long enough that a match is
// the sentence itself and not a word that also occurs in a fact.
const english = [
  reviewApprovalMessages,
  reviewDetailMessages,
  reviewFeeMessages,
  reviewSignMessages,
]
  .flatMap((catalog) => Object.entries(catalog.en))
  .filter(([key, text]) => {
    const zh = (
      [reviewApprovalMessages, reviewDetailMessages, reviewFeeMessages, reviewSignMessages].find(
        (catalog) => key in catalog.en,
      )?.["zh-Hans"] as Record<string, string> | undefined
    )?.[key];
    return text.length >= 12 && !text.includes("{") && zh !== text;
  })
  .map(([, text]) => text);

// What a reader perceives: visible text plus accessible names.
const perceived = (html: string): string => {
  const host = document.createElement("div");
  host.innerHTML = html;
  const attributes = [...host.querySelectorAll("[aria-label], [title]")].flatMap((element) => [
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ]);
  return `${host.textContent ?? ""}\n${attributes.join("\n")}`;
};

const leaks = (html: string): readonly string[] => {
  const text = perceived(html);
  return english.filter((sentence) => text.includes(sentence));
};

const card = (approval: Partial<PendingApproval> & Pick<PendingApproval, "kind">): string =>
  approvalCard({ context, id: ID, origin: ORIGIN, ...approval } as PendingApproval, status);

const zh = (): void => setUiLocale("zh-Hans");

describe("approval cards in Chinese", () => {
  test("invoke card: wallet words translated, facts verbatim", () => {
    zh();
    const html = card({
      fee: { overallFee: "0x2386f26fc10000", unit: "FRI" },
      kind: "invoke",
      summaries: ["Send 1.5 STRK to 0x1234…abcd"],
    });
    const text = perceived(html);
    expect(text).toContain("交易请求");
    expect(text).toContain("将会发生什么");
    expect(text).toContain("预估费用：");
    expect(text).toContain("0.01 STRK");
    expect(text).toContain("dapp.example");
    expect(text).toContain("批准");
    expect(text).toContain("拒绝");
    expect(leaks(html)).toEqual([]);
  });

  test("failed fee and deployment fee variants", () => {
    zh();
    const failed = reviewFeeSection({ fee: null, feeEstimateFailed: true }, { id: "r" });
    expect(perceived(failed)).toContain("目前无法估算网络费");
    expect(perceived(failed)).toContain("重新估算费用");
    const deploy = reviewFeeSection(
      {
        deploymentFee: { overallFee: "1500000000000000", unit: "FRI" },
        deploymentFeeEstimateFailed: false,
        fee: { overallFee: "2500000000000000", unit: "FRI" },
        requiresDeployment: true,
        signsTwice: true,
      },
      { id: "r" },
    );
    const text = perceived(deploy);
    expect(text).toContain("其中 0.0015 STRK 用于在 Starknet 上创建此账户");
    expect(text).toContain("你的 Ledger 会要求对这两笔交易都签名");
    expect(text).toContain("预估费用：0.004 STRK");
    expect(leaks(failed + deploy)).toEqual([]);
    expect(perceived(reviewFeeSection({ fee: null, feeEstimatePending: true }, {}))).toContain(
      "正在估算网络费",
    );
  });

  test("typed-data sign card keeps site text and marks unsigned values", () => {
    zh();
    const typedData = {
      domain: { chainId: "SN_MAIN", name: "Mail", revision: "1", version: "1" },
      message: { contents: "hello", extra: "not declared" },
      primaryType: "Mail",
      types: {
        Mail: [{ name: "contents", type: "shortstring" }],
        StarknetDomain: [
          { name: "name", type: "shortstring" },
          { name: "version", type: "shortstring" },
          { name: "chainId", type: "shortstring" },
          { name: "revision", type: "shortstring" },
        ],
      },
    };
    const html = card({ kind: "sign-typed-data", summaries: ["Mail"], typedData });
    const text = perceived(html);
    expect(text).toContain("签名请求");
    expect(text).toContain("原始类型化数据");
    expect(text).toContain("消息——由网站显示，但不会被签名");
    expect(text).toContain("⟨主类型⟩");
    // Site-supplied names and values are data, never translated.
    expect(text).toContain("contents");
    expect(text).toContain("not declared");
    expect(leaks(html)).toEqual([]);
    expect(signRequestView(typedData).classified).toBe(true);
  });

  test("connect, switch, watch-asset and declaration cards", () => {
    zh();
    const html = [
      card({ kind: "connect" }),
      card({ kind: "switch-chain", summaries: ["Switch to Starknet Sepolia"] }),
      card({
        kind: "watch-asset",
        token: { address: ADDRESS, decimals: 99, name: "", networkId: "SN_MAIN", symbol: "STRK" },
      }),
      card({
        declaration: {
          abiEntryCount: 14,
          accountDeployment: "undeployed",
          classHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
          compiledClassHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
          deploymentFee: { overallFee: "1500000000000000", unit: "FRI" },
          deploymentFeeEstimateFailed: false,
          entryPointCount: 9,
          fee: { overallFee: "2500000000000000", unit: "FRI" },
          feeEstimateFailed: false,
          sierraProgramLength: 4_321,
        },
        kind: "declare",
      }),
    ].join("");
    const text = perceived(html);
    for (const words of [
      "连接请求",
      "切换网络请求",
      "添加代币请求",
      "声明合约请求",
      "4,321 个 Sierra 字",
    ]) {
      expect(text).toContain(words);
    }
    expect(text).toContain("0.0025 STRK");
    expect(text).toContain("Starknet Mainnet");
    expect(leaks(html)).toEqual([]);
  });

  test("approval takeover chrome and queue", () => {
    zh();
    const first = { context, id: ID, kind: "connect", origin: ORIGIN } as PendingApproval;
    const second = { ...first, id: "c81c5dd1-53ff-4b7b-a171-0f0a08e0ff14" } as PendingApproval;
    const html = approvalTakeover([first, second], status, "home");
    const text = perceived(html);
    expect(text).toContain("检查请求");
    expect(text).toContain("后面还有 1 个请求在等待");
    expect(leaks(html)).toEqual([]);
  });
});

describe("outcomes and Ledger signing in Chinese", () => {
  test("outcome receipt and chain verdicts", () => {
    zh();
    expect(perceived(outcomeReceiptSection("x"))).toContain("在活动标签页查看");
    expect(confirmationOutcome("rejected")).toEqual({
      kind: "failed",
      message: "Starknet 拒绝了这笔交易。没有任何变化。",
      toast: "交易未被确认",
    });
    expect(leaks(outcomeReceiptSection("x"))).toEqual([]);
  });

  test("Ledger takeover shows the full hash and translated phases", () => {
    zh();
    const request = {
      accountId: account.id,
      id: "ledger-sign-1",
      messageHash: "0xabc",
      path: ledgerAccountPath(3),
      publicKeyX: "0x2",
    };
    const html = ["confirming", "connect", "devices"]
      .map((kind) =>
        ledgerSignScreen(
          {
            phase:
              kind === "devices"
                ? { devices: [{ id: "d1", label: "Nano X" }], kind: "devices" }
                : ({ kind } as never),
            request,
          },
          status,
        ),
      )
      .join("");
    const text = perceived(html);
    expect(text).toContain("你的 Ledger 上显示的哈希");
    expect(text).toContain("只有在与你设备上显示的内容逐个字符完全一致时才批准");
    expect(text).toContain("账户 3");
    expect(text).toContain("Nano X");
    // The device hash is shown at full padded width, group by group.
    expect(text.replace(/\s/gu, "")).toContain(`0x${"0".repeat(61)}abc`);
    expect(leaks(html)).toEqual([]);
  });
});

test("English is unchanged", () => {
  const html = card({ kind: "switch-chain", summaries: ["Switch to Starknet Sepolia"] });
  expect(html).toContain("Network switch request");
  expect(html).toContain("No transaction is signed and no network fee is charged.");
  // The leak check is not vacuous: in English it finds these very sentences.
  expect(leaks(html)).toContain("This site is asking to change the wallet's active network.");
});

describe("site warnings on cards", () => {
  test("a connect card renders the background's site warnings in Chinese, facts verbatim", async () => {
    const { insightEnglish, insightText } = await import("@bramble/permissions/insight-messages");
    const texts = [
      insightText("siteInsight.lookalike", { target: "starknet.io" }),
      insightText("siteInsight.firstSeen"),
    ];
    zh();
    const html = card({
      insightTexts: texts,
      insights: texts.map(insightEnglish),
      kind: "connect",
    });
    expect(html).not.toContain("closely resembles");
    expect(html).not.toContain("First time this wallet");
    expect(html).toContain("此域名与 starknet.io 极为相似");
    expect(html).toContain("此钱包首次见到此网站");
  });
});
