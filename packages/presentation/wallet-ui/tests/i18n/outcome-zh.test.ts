/**
 * An unknown submission outcome is decided on the English (so "already
 * unknown" detection is unchanged) and shown in the reader's language.
 */
import { afterEach, expect, test } from "bun:test";
import { setUiLocale } from "../../src/i18n/locale";
import { outcomeUnknownReason } from "../../src/sidepanel/shared/submit-outcome";

afterEach(() => setUiLocale("en"));

test("English is unchanged", () => {
  expect(outcomeUnknownReason(new Error("network request failed"), "The swap")).toContain(
    "The swap may not have gone through. Check Activity before trying again.",
  );
});

test("Chinese never states a failure for an unknown outcome", () => {
  setUiLocale("zh-Hans");
  const line = outcomeUnknownReason(new Error(""), "The transfer");
  expect(line).not.toContain("Check Activity");
  expect(line.length).toBeGreaterThan(0);
  expect(line).not.toMatch(/失败/u);
});
