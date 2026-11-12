/**
 * The review and confirm steps (signing text) in Simplified Chinese: each one
 * renders from its pinned catalog, no English sentence from those catalogs
 * leaks into visible text or accessible names, and every fact the English
 * states (amounts, fees, keys, thresholds, dates) appears verbatim.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { staleArgentMultisigIntent } from "@bramble/multisig/repository";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { setUiLocale } from "../../src/i18n/locale";
import { reviewStepsAccountMessages } from "../../src/i18n/messages/review-steps-account";
import { reviewStepsMultisigMessages } from "../../src/i18n/messages/review-steps-multisig";
import { reviewStepsSendMessages } from "../../src/i18n/messages/review-steps-send";
import { reviewStepsSwapMessages } from "../../src/i18n/messages/review-steps-swap";
import type { RecoveryReview } from "../../src/popup/responses/responses-recovery";
import { multisigDetailFlow } from "../../src/sidepanel/journeys/multisig/multisig-views";
import {
  buildRecoveryConfirm,
  readOnlyNotice,
} from "../../src/sidepanel/journeys/portfolio/recovery-view";
import { privacyFlow } from "../../src/sidepanel/journeys/privacy/privacy-views";
import {
  transferModeCopy,
  transferStageTitle,
} from "../../src/sidepanel/journeys/send/transfer-mode";
import {
  reviewRisksHtml,
  reviewSummaryHtml,
} from "../../src/sidepanel/journeys/send/transfer-review-markup";
import { routeDisclosureHtml } from "../../src/sidepanel/journeys/send/transfer-review-routes";
import { swapConfirmReceipt } from "../../src/sidepanel/journeys/swap/swap-views";
import { makeArgentMultisigFixture } from "../support/argent-multisig-fixtures";
import { registerDom, unregisterDom } from "../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
afterEach(() => setUiLocale("en"));

type Area = {
  readonly en: Readonly<Record<string, string>>;
  readonly "zh-Hans": Readonly<Record<string, string>>;
};
const AREAS: readonly Area[] = [
  reviewStepsAccountMessages,
  reviewStepsMultisigMessages,
  reviewStepsSendMessages,
  reviewStepsSwapMessages,
];

// Every literal run of a translated English message long enough to be a
// sentence fragment rather than a fact or a shared word.
const ENGLISH_FRAGMENTS: readonly string[] = AREAS.flatMap((area) =>
  Object.entries(area.en)
    .filter(([key, text]) => area["zh-Hans"][key] !== text)
    .flatMap(([, text]) => text.split(/\{[A-Za-z0-9]+\}/u))
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= 8),
);

// Visible text plus the accessible names a screen reader announces.
const readable = (html: string): string => {
  const host = document.createElement("div");
  host.innerHTML = html;
  const names = [...host.querySelectorAll("[aria-label]")].map(
    (node) => node.getAttribute("aria-label") ?? "",
  );
  return `${host.textContent ?? ""}\n${names.join("\n")}`;
};

// Words these catalogs share with `shared/review-render.ts`, whose own copy
// moves in the shared review PR: there they label the decoded-call list.
const SHARED_WITH_REVIEW_RENDER = new Set(["What will happen"]);

const leaks = (text: string): readonly string[] =>
  ENGLISH_FRAGMENTS.filter(
    (fragment) => !SHARED_WITH_REVIEW_RENDER.has(fragment) && text.includes(fragment),
  );

describe("the leak check", () => {
  test("catches an English review sentence", () => {
    expect(
      leaks(
        readable("<p>Confirm only if the recipient, amount, and decoded action are correct.</p>"),
      ),
    ).not.toEqual([]);
  });
});

describe("send review step", () => {
  const fields = {
    amount: "12.5",
    destination: "private",
    fiatEstimate: "",
    recipient: `0x${"1".repeat(63)}`,
    recipientLabel: "Savings",
    source: "public",
    tokenAddress: "0x4",
    tokenSymbol: "STRK",
  } as unknown as Parameters<typeof reviewSummaryHtml>[0];

  test("summary, notes, risks and visibility render in Chinese with every fact", () => {
    setUiLocale("zh-Hans");
    const html = [
      reviewSummaryHtml(
        fields,
        "shield",
        { address: `0x${"2".repeat(63)}`, label: "Main" },
        "Starknet Mainnet",
      ),
      reviewRisksHtml(
        { flags: [], requiresDeployment: true } as unknown as Parameters<typeof reviewRisksHtml>[0],
        true,
      ),
      routeDisclosureHtml({
        destination: "private",
        reveals: ["recipient"],
        source: "public",
      } as unknown as Parameters<typeof routeDisclosureHtml>[0]),
    ].join("");
    const text = readable(html);
    expect(text).toContain("发送方");
    expect(text).toContain("12.5 STRK");
    expect(text).toContain("公开余额 → 隐私余额");
    expect(text).toContain("此账户尚未部署");
    expect(text).toContain("新的收款人");
    expect(text).toContain("你正从公开余额发送到隐私余额。");
    expect(text).toContain("发送地址和金额均保密。收款地址公开。");
    expect(leaks(text)).toEqual([]);
    expect(transferStageTitle("review", "unshield")).toBe("检查转出隐私余额");
    expect(transferModeCopy("shield").reviewNote).toContain("仅在金额和解码后的操作都正确时确认");
  });

  test("English is unchanged, including the assembled visibility sentence", () => {
    const html = routeDisclosureHtml({
      destination: "private",
      reveals: ["recipient"],
      source: "public",
    } as unknown as Parameters<typeof routeDisclosureHtml>[0]);
    expect(readable(html)).toContain(
      "You are sending from a public balance to a private balance. Sender address and amount are confidential. Recipient address is public.",
    );
  });
});

describe("swap confirm step", () => {
  test("renders in Chinese with the enforced minimum verbatim", () => {
    setUiLocale("zh-Hans");
    const text = readable(
      swapConfirmReceipt({
        buyAddress: "0x2",
        buyAmount: "2",
        buySymbol: "ETH",
        gasFeesInUsd: 0,
        lossPercent: 0,
        minBuyAmount: "1.9",
        networkFee: { overallFee: "1000000000000000", unit: "FRI" },
        sellAddress: "0x1",
        sellAmount: "100",
        sellSymbol: "STRK",
        valueDelta: null,
      } as unknown as Parameters<typeof swapConfirmReceipt>[0]),
    );
    expect(text).toContain("你卖出");
    expect(text).toContain("最少收到");
    expect(text).toContain("1.9 ETH");
    expect(leaks(text)).toEqual([]);
  });
});

describe("multisig review", () => {
  test("the ready card, its technical details and deployment review render in Chinese", async () => {
    setUiLocale("zh-Hans");
    const fixture = await makeArgentMultisigFixture();
    const detail = multisigDetailFlow(
      fixture.status,
      fixture.status.accounts[0] ?? null,
      fixture.view,
      [fixture.readyIntent],
      false,
      defaultWalletPreferences(),
      "multisig-detail",
      undefined,
      fixture.readyIntent.id,
    );
    const text = readable(detail);
    expect(text).toContain("已检查的交易");
    expect(text).toContain("最高网络费");
    expect(text).toContain(fixture.readyIntent.prepared.nonce);
    expect(leaks(text)).toEqual([]);

    const deploy = readable(
      (
        await import("../../src/sidepanel/journeys/multisig/multisig-deploy-view")
      ).deploymentReviewMarkup(fixture.deploymentReview),
    );
    const { threshold, signerPublicKeys } = fixture.deploymentReview;
    expect(deploy).toContain(`部署一个 ${threshold}/${signerPublicKeys.length} 的 Ready 多签。`);
    expect(deploy).toContain("提交后，其地址、签名者集合、阈值和盐值都无法修改。");
    expect(deploy).toContain(fixture.deploymentReview.salt);
    expect(leaks(deploy)).toEqual([]);
  });

  test("a stale card keeps 'may have been sent' and never claims nothing was sent", async () => {
    setUiLocale("zh-Hans");
    const fixture = await makeArgentMultisigFixture();
    const stale = staleArgentMultisigIntent(fixture.readyIntent, "nonce");
    const text = readable(
      multisigDetailFlow(
        fixture.status,
        fixture.status.accounts[0] ?? null,
        fixture.view,
        [stale],
        false,
        defaultWalletPreferences(),
        "multisig-detail",
        undefined,
        stale.id,
      ),
    );
    expect(text).toContain("此交易可能已由另一位签名者发送。");
    expect(text).not.toContain("未发送");
    expect(leaks(text)).toEqual([]);
  });
});

describe("privacy activation review", () => {
  test("states the public registration and its pool fee in Chinese", () => {
    setUiLocale("zh-Hans");
    const text = readable(
      privacyFlow(
        {
          accountCount: 0,
          accounts: [],
          activeAccountId: null,
          hasVault: true,
          locked: false,
          network: "Starknet Mainnet",
          networkId: "SN_MAIN",
          networks: [],
          ready: true,
        } as unknown as Parameters<typeof privacyFlow>[0],
        defaultWalletPreferences(),
        {
          preparation: {
            id: "p",
            kind: "register",
            payloadDigest: "p",
            poolAddress: "0x12345678901234567890",
            poolFeeFri: "0x1",
            route: "public-account",
            summaries: [],
            symbol: "STRK",
            tokenId: "t",
          },
          stage: "activate-review",
          tokenId: "t",
        } as unknown as Parameters<typeof privacyFlow>[2],
      ),
    );
    expect(text).toContain("启用隐私余额");
    expect(text).toContain("它不会泄露查看密钥或你的隐私余额。");
    expect(text).toContain("一次性隐私池费用");
    expect(leaks(text)).toEqual([]);
  });
});

describe("guardian and 2FA recovery consent", () => {
  const review: RecoveryReview = {
    accountId: "a",
    expiresAt: 1_800_086_400,
    fee: { overallFee: "1000000000000000", unit: "FRI" } as unknown as RecoveryReview["fee"],
    ok: true,
    readyAt: 1_800_000_000,
    replaces: { kind: "owner-escape" } as unknown as RecoveryReview["replaces"],
    step: "start",
  };

  test("the start confirmation keeps every condition and date in Chinese", () => {
    setUiLocale("zh-Hans");
    const { panel } = buildRecoveryConfirm(document, "argent", review);
    const text = panel.textContent ?? "";
    expect(text).toContain("要移除此账户的守护者吗？");
    expect(text).toContain(
      "你的守护者已开始更换此账户的密钥。继续操作将取消该变更。如果是你发起的，就不要继续。",
    );
    expect(text).toContain("仅凭你的助记词即可控制此账户");
    expect(text).toMatch(
      /在 \d\d\/\d\d\/\d\d \d\dh\d\d UTC 之后、\d\d\/\d\d\/\d\d \d\dh\d\d UTC 之前完成移除/u,
    );
    expect(leaks(text)).toEqual([]);
  });

  test("English keeps its exact date form", () => {
    const { panel } = buildRecoveryConfirm(document, "braavos", review);
    expect(panel.textContent ?? "").toMatch(
      /Takes effect after \d\d\/\d\d\/\d\d at \d\dh\d\d UTC\./u,
    );
  });

  test("the read-only notice and its action render in Chinese", () => {
    setUiLocale("zh-Hans");
    const text = readable(
      readOnlyNotice(
        { readOnly: true, reason: "guardian" } as unknown as Parameters<typeof readOnlyNotice>[0],
        false,
      ),
    );
    expect(text).toContain("只读");
    expect(text).toContain("恢复账户");
    expect(leaks(text)).toEqual([]);
  });
});
