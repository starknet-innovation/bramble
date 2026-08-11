/**
 * Class-hash verification response guard: a `verification` field that is not a
 * record (e.g. a string) must be rejected outright, so a non-object payload can
 * never be read as a verdict.
 */
import { describe, expect, test } from "bun:test";
import { isClassHashVerificationResponse } from "../../src/popup/responses-verify";

const ACCOUNT_ID = "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

describe("isClassHashVerificationResponse non-record verification", () => {
  test("rejects a verification payload that is not an object", () => {
    // The outer shape is otherwise valid, so this drives execution into the
    // inner verdict parser, whose first check rejects a non-record value.
    expect(
      isClassHashVerificationResponse({
        accountId: ACCOUNT_ID,
        ok: true,
        verification: "verified",
      }),
    ).toBe(false);
  });

  test("rejects a null verification payload for the same reason", () => {
    expect(
      isClassHashVerificationResponse({ accountId: ACCOUNT_ID, ok: true, verification: null }),
    ).toBe(false);
  });
});
