/**
 * Ledger rejection sentences per language: English is exactly `ledgerMessage`,
 * and every code has its own plain-text translation.
 */
import { expect, test } from "bun:test";
import { ledgerMessage } from "@bramble/ledger-protocol/errors";
import { ledgerMessageIn, ledgerMessagesByEnglish } from "@bramble/ledger-protocol/errors-i18n";

test("English is the single-source catalog, unchanged", () => {
  for (const [english, rendered] of ledgerMessagesByEnglish("en")) expect(rendered).toBe(english);
  expect(ledgerMessageIn("device-locked", "en")).toBe(ledgerMessage("device-locked"));
});

test("every code has a distinct, plain Chinese sentence", () => {
  const zh = [...ledgerMessagesByEnglish("zh-Hans").values()];
  expect(zh.length).toBe(ledgerMessagesByEnglish("en").size);
  expect(new Set(zh).size).toBe(zh.length);
  for (const sentence of zh) {
    expect(sentence.trim()).toBe(sentence);
    expect(sentence).not.toMatch(/[<>]/u);
    expect(sentence).toMatch(/[一-鿿]/u);
  }
});
