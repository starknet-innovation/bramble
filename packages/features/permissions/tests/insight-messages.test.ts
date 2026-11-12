/**
 * Site warnings: complete in every locale, pinned to their English, and
 * decided as references whose English is exactly what `originInsights`
 * returns.
 */
import { expect, test } from "bun:test";
import { catalogFailures } from "@bramble/core/i18n";
import { originInsights } from "@bramble/permissions/blocklist";
import {
  insightEnglish,
  insightMessages,
  isInsightText,
} from "@bramble/permissions/insight-messages";
import { INSIGHT_MESSAGE_PINS } from "./insight-message-pins";

const pin = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);

test("every locale covers every site warning with the same facts", () => {
  expect(catalogFailures(insightMessages)).toEqual([]);
});

test("every translation is pinned to the English it was made from", () => {
  const stale = Object.entries(insightMessages.en)
    .filter(([key, text]) => INSIGHT_MESSAGE_PINS[key] !== pin(text))
    .map(([key, text]) => `${key}: re-translate, then pin ${pin(text)}`);
  expect(stale).toEqual([]);
  expect(Object.keys(INSIGHT_MESSAGE_PINS).sort()).toEqual(Object.keys(insightMessages.en).sort());
});

test("each warning's reference renders to exactly its English, fact included", () => {
  for (const origin of [
    "https://xn--starkne-xyz.com",
    "https://app.starknet.xyz",
    "not a url",
    "https://example.org",
  ]) {
    const insight = originInsights(origin, { firstSeenAt: null });
    expect(insight.warningTexts?.map(insightEnglish)).toEqual([...insight.warnings]);
    expect(insight.warningTexts?.every(isInsightText)).toBe(true);
  }
  expect(originInsights("https://example.org", { connected: true }).warnings).toEqual([
    "You have connected to this site before.",
  ]);
});
