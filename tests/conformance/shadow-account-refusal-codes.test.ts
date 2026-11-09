/**
 * The shadow-account refusals are stable codes (audit F6): the panel's curated
 * error copy maps each with one entry, so a code that changes silently drops
 * its sentence. This pins every value, background and vault, in one place, and
 * checks the conformance error scan still sees each one where it is thrown.
 */
import { describe, expect, test } from "bun:test";
import * as refusals from "@bramble/privacy/shadow-account-refusals";
import {
  SHADOW_ACCOUNT_RECORD_INVALID,
  SHADOW_ACCOUNT_RECORD_LIMIT,
} from "@bramble/vault/shadow-account-scopes";
import { PANEL_ERROR_SOURCES, thrownMessages } from "./internal-error-scan";

const CODES = {
  ...refusals,
  SHADOW_ACCOUNT_RECORD_INVALID,
  SHADOW_ACCOUNT_RECORD_LIMIT,
};

describe("shadow-account refusal codes", () => {
  test("every code keeps its value", () => {
    expect(CODES).toEqual({
      SHADOW_ACCOUNT_ANONYMIZER_CHANGED: "shadow account anonymizer changed",
      SHADOW_ACCOUNT_HOLDS_NO_TRACKED_TOKEN: "shadow account holds no tracked token",
      SHADOW_ACCOUNT_RECORDS_UNAVAILABLE: "shadow account records unavailable",
      SHADOW_ACCOUNT_RECORD_INVALID: "invalid shadow account record",
      SHADOW_ACCOUNT_RECORD_LIMIT: "shadow account record limit reached",
      SHADOW_ACCOUNT_SCOPE_NOT_RECORDED: "shadow account scope not recorded",
      SHADOW_SWEEP_BREAKS_BATCH_RULE: "shadow sweep batch breaks a batch rule",
    });
    expect(new Set(Object.values(CODES)).size).toBe(Object.keys(CODES).length);
  });

  test("the error scan finds every code where production throws it", () => {
    const scanned = new Set(thrownMessages(PANEL_ERROR_SOURCES).map((message) => message.raw));
    for (const code of Object.values(CODES)) {
      expect(scanned.has(code)).toBe(true);
    }
  });
});
