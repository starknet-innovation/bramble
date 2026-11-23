/**
 * The Ledger grant tab's copy: complete in every locale with matching facts and
 * no markup, and the progress copy follows the tab's language while keeping
 * the "nothing is signed" statement on the device prompt.
 */
import { afterEach, expect, test } from "bun:test";
import { catalogFailures } from "@bramble/core/i18n";
import {
  gt,
  ledgerGrantMessages,
  setGrantLocale,
} from "../../apps/extension/src/ledger-grant/messages";
import {
  ledgerHandshakeProgress,
  ledgerTransitionProgress,
} from "../../apps/extension/src/ledger-grant/transition-progress";

afterEach(() => setGrantLocale("en"));

test("every locale covers every grant-tab message with the same facts and no markup", () => {
  expect(catalogFailures(ledgerGrantMessages)).toEqual([]);
});

test("progress copy follows the tab's language", () => {
  setGrantLocale("zh-Hans");
  expect(ledgerTransitionProgress("opening-starknet")).toEqual({
    message: "在 Ledger 上确认提示。不会签名任何交易。",
    title: "批准打开 Starknet",
  });
  expect(ledgerHandshakeProgress().message).toBe("不会签名任何交易。");
});

test("facts are filled in verbatim", () => {
  setGrantLocale("zh-Hans");
  expect(gt("ledgerGrant.connected.copy", { version: "2.3.1" })).toBe(
    "Starknet 2.3.1 已验证。Bramble 可以继续。",
  );
  setGrantLocale("en");
  expect(gt("ledgerGrant.connected.copy", { version: "2.3.1" })).toBe(
    "Starknet 2.3.1 verified. Bramble is ready to continue.",
  );
});
