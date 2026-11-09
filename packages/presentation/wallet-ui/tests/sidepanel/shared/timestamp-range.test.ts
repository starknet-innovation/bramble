/**
 * A timestamp past the ECMAScript Date range renders as missing instead of
 * throwing, so one bad activity row cannot break the whole screen
 * (Sherlock 238).
 */
import { describe, expect, test } from "bun:test";
import { MAX_ACTIVITY_TIMESTAMP_MS } from "@bramble/transactions/activity";
import {
  formatUtcClock,
  formatUtcDate,
  formatUtcDay,
} from "../../../src/sidepanel/shared/timestamp";

describe("timestamps past the Date range", () => {
  test("format as missing", () => {
    const past = MAX_ACTIVITY_TIMESTAMP_MS + 1_000;
    expect(formatUtcDay(past)).toBeNull();
    expect(formatUtcDate(past)).toBeNull();
    expect(formatUtcClock(past)).toBeNull();
  });

  test("the last representable instant still formats", () => {
    expect(formatUtcDate(MAX_ACTIVITY_TIMESTAMP_MS)).toContain("275760");
  });
});
