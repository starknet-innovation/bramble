/**
 * Error copy in Chinese: every reviewed sentence the copy tables can show has
 * a translation keyed by its exact English (so editing the English fails here
 * until the translation is redone), raw messages shown as written stay as
 * written, and `friendlyError` itself keeps returning English.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { NETWORK_ERROR_MESSAGE, NETWORK_RETRY_MESSAGE } from "@bramble/core/network-error";
import { ledgerMessage } from "@bramble/ledger-protocol/errors";
import { ledgerMessageIn } from "@bramble/ledger-protocol/errors-i18n";
import { ERROR_COPY_ZH, localizeErrorCopy } from "../../src/i18n/error-copy";
import { ERROR_COPY_ZH_A } from "../../src/i18n/error-copy-zh-a";
import { ERROR_COPY_ZH_B } from "../../src/i18n/error-copy-zh-b";
import { ERROR_COPY_ZH_UI } from "../../src/i18n/error-copy-zh-ui";
import { setUiLocale } from "../../src/i18n/locale";
import { friendlyError } from "../../src/sidepanel/runtime/friendly-error";
import * as copy from "../../src/sidepanel/runtime/friendly-error-copy";
import * as shared from "../../src/sidepanel/runtime/friendly-error-shared";

afterEach(() => setUiLocale("en"));

// Raw diagnostics and service facts the tables show exactly as written.
const AS_WRITTEN = new Set([
  "Argent multisig private proof is missing",
  "Insufficient private balance",
  "Invalid Argent multisig private proof",
  "invalid multisig private action",
  "strk20 private submission unavailable",
  "swap build returned more than one swap call",
  "swap build returned no swap call",
  "swap build returned too many calls",
]);

// The STRK20 classifier's heads, which a sanitised reason follows.
const STRK20_HEADS = [
  "Starknet rejected the private transaction",
  "The fee couldn't be covered",
  "The account's nonce changed. Review the transaction again.",
  "The privacy pool rejected the proof",
  "The private transaction failed validation",
];

const strings = (module: Record<string, unknown>): string[] =>
  Object.values(module).flatMap((value) =>
    typeof value === "string"
      ? [value]
      : value && typeof value === "object" && !(value instanceof Map) && !Array.isArray(value)
        ? Object.values(value).filter((item): item is string => typeof item === "string")
        : [],
  );

const reviewedEnglish = (): Set<string> =>
  new Set(
    [
      ...copy.ERROR_COPY.values(),
      ...strings(copy),
      ...strings(shared),
      NETWORK_ERROR_MESSAGE,
      NETWORK_RETRY_MESSAGE,
      ...STRK20_HEADS,
    ].filter((english) => !AS_WRITTEN.has(english)),
  );

describe("coverage", () => {
  test("every reviewed sentence has a translation", () => {
    expect([...reviewedEnglish()].filter((english) => !ERROR_COPY_ZH.has(english))).toEqual([]);
  });

  test("no translation is left for English that no longer exists", () => {
    const current = reviewedEnglish();
    const stale = Object.keys({ ...ERROR_COPY_ZH_A, ...ERROR_COPY_ZH_B }).filter(
      (english) => !current.has(english),
    );
    expect(stale).toEqual([]);
  });

  test("every panel-written sentence still exists, verbatim, in the panel source", async () => {
    const root = join(import.meta.dir, "../../src");
    const files = (await readdir(root, { recursive: true })).filter(
      (file) => file.endsWith(".ts") && !file.startsWith("i18n/"),
    );
    const source = (await Promise.all(files.map((file) => Bun.file(join(root, file)).text()))).join(
      "\n",
    );
    const stale = Object.keys(ERROR_COPY_ZH_UI).filter(
      (english) => !source.includes(`"${english}"`),
    );
    expect(stale).toEqual([]);
  });

  test("translations are plain, trimmed text", () => {
    for (const [english, zh] of ERROR_COPY_ZH) {
      expect(zh.length, english).toBeGreaterThan(0);
      expect(zh.trim(), english).toBe(zh);
      expect(zh, english).not.toMatch(/[<>]/u);
    }
  });
});

const shown = (raw: string): string => localizeErrorCopy(friendlyError(raw).message);

describe("friendlyError output, displayed", () => {
  test("English readers see exactly what they did", () => {
    for (const raw of ["wallet locked", "invalid foo request", "device-locked", "boom failed"]) {
      expect(shown(raw)).toBe(friendlyError(raw).message);
    }
  });

  test("a mapped diagnostic reads in Chinese; friendlyError stays English", () => {
    setUiLocale("zh-Hans");
    expect(friendlyError("wallet locked").message).toBe(
      "The wallet is locked or unavailable. Unlock it and try again.",
    );
    expect(shown("wallet locked")).toBe("钱包已锁定或不可用。解锁后重试。");
    expect(shown("invalid foo request")).toBe("该请求有些地方不对。检查详情后重试。");
  });

  test("the fallback and an outcome-unknown sentence keep their meaning", () => {
    setUiLocale("zh-Hans");
    expect(shown("boom failed")).toBe("出了点问题。重试。");
    expect(shown("transaction approval failed")).toBe("批准可能没有成功。重试前先查看活动。");
  });

  test("a raw message shown as written stays as written", () => {
    setUiLocale("zh-Hans");
    expect(shown("swap build returned no swap call")).toBe("swap build returned no swap call");
    expect(shown("Some Service Said No")).toBe("Some Service Said No");
  });

  test("a sentence the panel writes itself reads in Chinese", () => {
    setUiLocale("zh-Hans");
    expect(localizeErrorCopy("Review this send first")).toBe("先检查此发送。");
    expect(shown("Your browser did not grant access to that service host")).toBe(
      "你的浏览器未授权访问该服务主机",
    );
  });

  test("a Ledger code reads as its Chinese sentence", () => {
    setUiLocale("zh-Hans");
    expect(shown("device-locked")).toBe(ledgerMessageIn("device-locked", "zh-Hans"));
    expect(ledgerMessageIn("device-locked", "en")).toBe(ledgerMessage("device-locked"));
  });

  test("a STRK20 head is translated and its sanitised reason kept verbatim", () => {
    setUiLocale("zh-Hans");
    expect(shown("strk20 services unavailable (submit/execution-reverted): out of gas")).toBe(
      "Starknet 拒绝了这笔隐私交易：out of gas",
    );
    expect(shown("strk20 services unavailable (submit/execution-reverted)")).toBe(
      "Starknet 拒绝了这笔隐私交易。",
    );
    expect(shown("strk20 services unavailable (submit/rate-limited): 429")).toBe(
      "此服务正在限制请求频率。稍等片刻后重试。 (429)",
    );
  });
});
