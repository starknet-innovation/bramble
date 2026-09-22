/** Actionable refusals are classified by validated kind, never by wording. */
import { describe, expect, test } from "bun:test";
import {
  PrivacyBlockerError,
  readPrivacyBlockerError,
} from "@bramble/wallet-protocol/privacy-blocker";
import { privacyBlockerFor } from "../../../../src/sidepanel/journeys/privacy/privacy-model";

describe("privacyBlockerFor", () => {
  test("keeps every typed action even when its copy changes", () => {
    for (const kind of ["deploy", "fund", "ledger", "network", "pending", "service"] as const) {
      expect(privacyBlockerFor(new PrivacyBlockerError(kind, "Reworded explanation"))).toEqual({
        kind,
        message: "Reworded explanation",
      });
    }
  });
  test("does not infer actions from arbitrary text", () => {
    expect(privacyBlockerFor(new Error("Deploy this account first")).kind).toBe("service");
    expect(privacyBlockerFor("Not enough STRK").kind).toBe("service");
  });
  test("rejects malformed runtime blockers", () => {
    for (const value of [
      { error: "Reason", privacyBlocker: "unknown" },
      { error: "", privacyBlocker: "deploy" },
      { error: "Reason", privacyBlocker: "deploy", ok: true },
    ]) {
      expect(readPrivacyBlockerError(value)).toBeNull();
    }
  });
});
