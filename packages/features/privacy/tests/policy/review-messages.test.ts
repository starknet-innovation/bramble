/**
 * STRK20 review sentences: complete in every locale, pinned to their English,
 * and decided as references whose English is exactly what the summaries have
 * always read.
 */
import { describe, expect, test } from "bun:test";
import { catalogFailures } from "@bramble/core/i18n";
import {
  isStrk20ReviewText,
  strk20English,
  strk20Lines,
  strk20ReviewMessages,
  strk20Text,
} from "@bramble/privacy/review-messages";
import {
  strk20ActionText,
  strk20BatchTexts,
  summarizeStrk20Action,
  summarizeStrk20Batch,
} from "@bramble/privacy/service";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import { STRK20_REVIEW_PINS } from "./review-message-pins";

const pin = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);

test("every locale covers every STRK20 review sentence with the same facts", () => {
  expect(catalogFailures(strk20ReviewMessages)).toEqual([]);
});

test("every translation is pinned to the English it was made from", () => {
  const stale = Object.entries(strk20ReviewMessages.en)
    .filter(([key, text]) => STRK20_REVIEW_PINS[key] !== pin(text))
    .map(([key, text]) => `${key}: re-translate, then pin ${pin(text)}`);
  expect(stale).toEqual([]);
  expect(Object.keys(STRK20_REVIEW_PINS).sort()).toEqual(
    Object.keys(strk20ReviewMessages.en).sort(),
  );
});

const TOKEN = `0x${"4".repeat(64)}`;
const OTHER = `0x${"5".repeat(64)}`;
const ACTIONS = [
  { amount: "0x10", token: TOKEN, type: "deposit" },
  { amount: "0x10", recipient: OTHER, token: TOKEN, type: "withdraw" },
  { amount: "OPEN", recipient: OTHER, token: TOKEN, type: "transfer" },
] as unknown as readonly Strk20Action[];

describe("references", () => {
  test("each action's reference renders to exactly its summary", () => {
    for (const action of ACTIONS) {
      expect(strk20English(strk20ActionText(action))).toBe(summarizeStrk20Action(action));
      expect(isStrk20ReviewText(strk20ActionText(action))).toBe(true);
    }
    expect(summarizeStrk20Action(ACTIONS[2] as Strk20Action)).toContain("an open note");
  });

  test("a batch's references pair with its summaries line for line", () => {
    expect(strk20BatchTexts(ACTIONS).map(strk20English)).toEqual([
      ...summarizeStrk20Batch(ACTIONS),
    ]);
  });

  test("lines carry references only when every one is valid", () => {
    const ok = strk20Text("strk20Review.prepare.proof");
    expect(strk20Lines([ok]).summaryTexts).toEqual([ok]);
    const empty = strk20Text("strk20Review.balances.token", { token: "" });
    expect(strk20Lines([ok, empty])).toEqual({
      summaries: ["Generate a submittable private proof for this site", "Token "],
    });
  });
});
