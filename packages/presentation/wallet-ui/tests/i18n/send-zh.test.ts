/**
 * Send and Receive render in Simplified Chinese when that is the UI language:
 * their own catalog sentences appear, facts stay as the code formatted them,
 * and no English sentence from the send catalog leaks into the markup. The
 * review step is signing text and stays English until the approvals catalog.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import { setUiLocale } from "../../src/i18n/locale";
import { uiCatalogs } from "../../src/i18n/messages";
import type { TokenBalance, WalletStatus } from "../../src/popup/responses/responses";
import {
  classHashVerificationBadge,
  privacyPoolNotice,
  RECEIVE_QR_LABELS,
  receiveAddressView,
} from "../../src/sidepanel/journeys/send/receive-view";
import { sendBalanceLine } from "../../src/sidepanel/journeys/send/send-model";
import { sendFlow } from "../../src/sidepanel/journeys/send/send-views";
import { composeFeeLines } from "../../src/sidepanel/journeys/send/transfer-compose-fee";
import {
  transferFailureTitle,
  transferModeCopy,
  transferSentFailureReason,
  transferSentFailureTitle,
  transferStageTitle,
  transferSuccessSummary,
  transferUnknownTitle,
  transferWorkingTitle,
} from "../../src/sidepanel/journeys/send/transfer-mode";
import { successReceiptHtml } from "../../src/sidepanel/journeys/send/transfer-review-markup";
import { transferPreferences } from "../support/transfer-ui-harness";

afterEach(() => setUiLocale("en"));

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
const preferences: WalletPreferences = transferPreferences;
const balances: readonly TokenBalance[] = preferences.tokens.map(
  (token): TokenBalance => ({ ...token, balance: "1000000000000000000", formatted: "1" }),
);
const unregistered = {
  error: null,
  loading: false,
  value: { registration: "unregistered" },
} as unknown as Parameters<typeof privacyPoolNotice>[0];
const HASH_A = `0x${"a".repeat(63)}`;
const HASH_B = `0x${"b".repeat(63)}`;

// Every placeholder-free English send/receive sentence long enough not to
// collide with markup (ids and attribute names are lowercase or short).
const englishSentences = Object.entries(uiCatalogs.en)
  .filter(([key, text]) => /^(?:send|receive)\./u.test(key) && !text.includes("{"))
  .map(([, text]) => text)
  .filter((text) => text.length > 6);

// What a reader meets: text between tags plus accessible names, titles and
// placeholders. Attribute names and form field names are not copy. The review
// step is signing text that stays English, so it is left out.
const readable = (html: string): string => {
  const shown = html.replace(/<section[^>]*id="send-review-stage"[\s\S]*?<\/section>/u, "");
  const names = [...shown.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/gu)].map(
    (match) => match[1] ?? "",
  );
  return `${shown.replace(/<[^>]*>/gu, " ")} ${names.join(" ")}`;
};

const leaks = (html: string): readonly string[] => {
  const text = readable(html);
  return englishSentences.filter(
    (english) => text.includes(escapeHtml(english)) || text.includes(english),
  );
};

const screens = (): Readonly<Record<string, string>> => ({
  pool: privacyPoolNotice(unregistered) + privacyPoolNotice(unregistered, "fund-first"),
  receive: receiveAddressView({
    address: account.address,
    classHash: HASH_A,
    classHashVerification: { status: "verified" } as never,
    copyLabel: "复制",
    hint: "提示",
    networkId: account.networkId,
    publicKeyX: account.publicKeyX ?? HASH_B,
  }),
  send: sendFlow(status, account, preferences, balances),
});

describe("Send and Receive in Simplified Chinese", () => {
  test("no English send or receive sentence reaches the rendered screens", () => {
    setUiLocale("zh-Hans");
    for (const [name, html] of Object.entries(screens())) {
      expect(leaks(html), name).toEqual([]);
    }
  });

  test("the send flow carries its Chinese copy and keeps its facts", () => {
    setUiLocale("zh-Hans");
    const { send } = screens();
    for (const text of ["发送给", "地址簿", "使用此地址继续", "资产", "估值 —", "交易未发送"]) {
      expect(send).toContain(text);
    }
    expect(sendBalanceLine("public", "1.5", "STRK")).toBe("余额 1.5 STRK");
    expect(sendBalanceLine("private", null, "STRK")).toBe("隐私余额不可用");
  });

  test("mode copy and the pinned review step both follow the language", () => {
    setUiLocale("zh-Hans");
    expect(transferStageTitle("details", "shield")).toBe("转入隐私余额");
    expect(transferStageTitle("failed", "unshield")).toBe("转出隐私余额失败");
    expect(transferModeCopy("send").successTitle).toBe("发送完成");
    expect(transferStageTitle("review", "send")).toBe("检查发送");
    expect(transferModeCopy("send").confirmLabel).toBe("确认并发送");
    expect(transferSuccessSummary("shield", "1", "ETH", "")).toBe("1 ETH 已转入你的隐私余额");
  });

  test("outcome titles, the working line and fee notes follow the language", () => {
    setUiLocale("zh-Hans");
    expect([
      transferFailureTitle(),
      transferSentFailureTitle(),
      transferUnknownTitle(),
      transferSentFailureReason(),
      transferWorkingTitle("unshield"),
    ]).toEqual([
      "交易未发送",
      "交易失败",
      "状态未知",
      "交易已发送但未完成。在活动中查看其状态。",
      "正在转出隐私余额…",
    ]);
    const shield = (leavesNoGas: boolean) =>
      composeFeeLines(
        {
          fields: {},
          gasInStrk: !leavesNoGas,
          leavesNoGas,
          poolFee: null,
          route: { feeBucket: "none", id: "public-private", poolFeeRequired: false },
        } as never,
        { failed: false, review: null },
      );
    expect(shield(true)).toEqual(["留出足够的 STRK 支付网络费。"]);
    expect(shield(false)).toEqual(["网络费同样以公开 STRK 支付。"]);
  });

  test("the receipt puts each fact where the translation places it, escaped", () => {
    setUiLocale("zh-Hans");
    const html = successReceiptHtml(
      { amount: "2", recipient: HASH_B, recipientLabel: "<Bob>", tokenSymbol: "ETH" } as never,
      { address: HASH_A, label: "Alice" },
      "send",
    );
    expect(html.startsWith("<strong>Alice</strong> ")).toBe(true);
    expect(html).toContain(" 已向 <strong>&lt;Bob&gt;</strong> ");
    expect(html).toContain(" 发送 <strong>2 ETH</strong>");
    expect(html).not.toContain("<Bob>");
  });

  test("the receive card and its verdicts read in Chinese", () => {
    setUiLocale("zh-Hans");
    const { pool, receive } = screens();
    expect(receive).toContain("你的 Starknet 地址");
    expect(receive).toContain("已在链上验证");
    expect(pool).toContain("仅支持公开转账");
    expect(RECEIVE_QR_LABELS.card).toBe("钱包名片二维码");
    const mismatch = classHashVerificationBadge({
      expectedClassHash: HASH_B,
      onChainClassHash: HASH_A,
      status: "mismatch",
    } as never);
    expect(mismatch).toContain(
      `<code>${HASH_A}</code>，而不是此钱包预期的类 <code>${HASH_B}</code>`,
    );
  });

  test("English output is unchanged where facts are fragments", () => {
    const html = successReceiptHtml(
      { amount: "2", recipient: HASH_B, recipientLabel: "", tokenSymbol: "ETH" } as never,
      { address: "", label: "" },
      "send",
    );
    expect(html.startsWith("Sent <strong>2 ETH</strong> to <span")).toBe(true);
    expect(RECEIVE_QR_LABELS.address).toBe("QR code for your Starknet address");
  });

  test("the leak check would catch English", () => {
    expect(leaks(screens()["send"] ?? "")).toContain("Continue with address");
  });
});
