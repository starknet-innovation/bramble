/**
 * The onboarding and unlock screens render entirely in Simplified Chinese when
 * that is the UI language: their own catalog sentences appear, and no English
 * sentence from the onboarding catalog leaks into the markup.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { escapeHtml } from "@bramble/core/html";
import { setUiLocale } from "../../src/i18n/locale";
import { uiCatalogs } from "../../src/i18n/messages";
import { locked, onboarding } from "../../src/sidepanel/journeys/onboarding/gate-views";
import {
  onboardingComplete,
  onboardingLaunch,
} from "../../src/sidepanel/journeys/onboarding/onboarding-surface";
import { emptyStatus } from "../../src/sidepanel/runtime/runtime";

afterEach(() => setUiLocale("en"));

const ready = { ...emptyStatus(), hasVault: true, locked: true, ready: true };

// Every placeholder-free English onboarding sentence long enough not to collide
// with markup (ids, attribute names and tags are lowercase or short).
const englishSentences = Object.entries(uiCatalogs.en)
  .filter(([key, text]) => key.startsWith("onboarding.") && !text.includes("{"))
  .map(([, text]) => text)
  .filter((text) => text.length > 6);

const leaks = (html: string): readonly string[] =>
  englishSentences.filter((text) => html.includes(text) || html.includes(escapeHtml(text)));

const screens = (): Readonly<Record<string, string>> => ({
  complete: onboardingComplete(),
  invalid: locked({ ...ready, recovery: "invalid" }),
  launch: onboardingLaunch(),
  rollback: locked({ ...ready, recovery: "rollback" }),
  unlock: locked(ready, [
    { id: "a1", kind: "connect", origin: "https://dapp.example", createdAt: 1 },
  ] as unknown as Parameters<typeof locked>[1]),
  unverified: locked({ ...ready, recovery: "unverified" }),
  wizard: onboarding(ready, true),
});

describe("onboarding in Simplified Chinese", () => {
  test("no English onboarding sentence reaches any first-run or unlock screen", () => {
    setUiLocale("zh-Hans");
    for (const [name, html] of Object.entries(screens())) {
      expect(leaks(html), name).toEqual([]);
    }
  });

  test("the unlock and setup screens carry their Chinese copy", () => {
    setUiLocale("zh-Hans");
    const { rollback, unlock, wizard } = screens();
    expect(unlock).toContain("欢迎回来");
    expect(unlock).toContain("解锁");
    expect(rollback).toContain("此钱包不是最新版本");
    expect(rollback).toContain("仍然解锁");
    for (const text of [
      "创建新钱包",
      "添加已有钱包",
      "保存你的助记词",
      "创建钱包密码",
      "查找你的账户",
    ]) {
      expect(wizard).toContain(text);
    }
  });

  test("the leak check would catch English", () => {
    setUiLocale("en");
    expect(leaks(screens()["wizard"] ?? "")).toContain("Create a new wallet");
  });
});
