/**
 * Signing text in the wallet UI is pinned like the verifier's review
 * sentences: every message in a `src/i18n/messages/review-*.ts` catalog (the
 * words on a screen where the user reviews or confirms a transaction or a
 * signature) has its English hashed in `review-pins.ts`. Changing that English
 * fails here until every translation of it is redone and its pin updated.
 */
import { expect, test } from "bun:test";
import { UI_AREA_CATALOGS } from "../../src/i18n/messages";
import { REVIEW_UI_PINS } from "./review-pins";

const pin = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);

// The English of every `review-*` area catalog.
const reviewEnglish = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(UI_AREA_CATALOGS)
      .filter(([area]) => area.startsWith("review-"))
      .flatMap(([, catalog]) => Object.entries(catalog.en as Readonly<Record<string, string>>)),
  );

test("every signing-screen translation is pinned to the English it was made from", () => {
  const english = reviewEnglish();
  const stale = Object.entries(english)
    .filter(([key, text]) => REVIEW_UI_PINS[key] !== pin(text))
    .map(([key, text]) => `${key}: re-translate, then pin "${pin(text)}"`);
  expect(stale).toEqual([]);
  expect(Object.keys(REVIEW_UI_PINS).sort()).toEqual(Object.keys(english).sort());
});
