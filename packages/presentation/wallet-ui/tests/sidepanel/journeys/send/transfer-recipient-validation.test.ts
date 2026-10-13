/**
 * Send-form recipient validation proves malformed addresses are caught inline
 * before `reviewTransfer` runs, and that the background's developer error
 * string is mapped onto the same friendly message.
 */
import { expect, test } from "bun:test";

import {
  activityExportToast,
  friendlyReviewError,
  recipientFieldError,
} from "../../../../src/sidepanel/journeys/send/transfer-ui";

const INVALID_RECIPIENT_MESSAGE = "Enter a valid Starknet address.";

test("accepts well-formed Starknet field-element recipients", () => {
  expect(recipientFieldError("0x1")).toBeNull();
  expect(recipientFieldError(`0x${"0".repeat(63)}1`)).toBeNull();
});

test("accepts checksummed (mixed-case) addresses by normalizing the case", () => {
  // Hex is case-insensitive: a checksummed/mixed-case 0x address (as pasted
  // from Voyager/Starkscan or another wallet) denotes the same field element
  // as its lowercase spelling, so it must be accepted, not rejected.
  expect(
    recipientFieldError("0x02Fd23d9182193775423497fC0c472E156C57C69E4089A1967fb288A2d84e914"),
  ).toBeNull();
  expect(recipientFieldError("0xABC")).toBeNull();
});

test("rejects malformed recipients with an inline message", () => {
  expect(recipientFieldError("")).toBe(INVALID_RECIPIENT_MESSAGE);
  expect(recipientFieldError("not-an-address")).toBe(INVALID_RECIPIENT_MESSAGE);
  expect(recipientFieldError("0xZZ")).toBe(INVALID_RECIPIENT_MESSAGE);
  expect(
    recipientFieldError("0x800000000000011000000000000000000000000000000000000000000000001"),
  ).toBe(INVALID_RECIPIENT_MESSAGE);
});

test("maps the background review error onto the friendly recipient message", () => {
  expect(friendlyReviewError(new Error("invalid transfer review request"))).toBe(
    INVALID_RECIPIENT_MESSAGE,
  );
});

test("translates other review errors, never passing a raw diagnostic through", () => {
  expect(friendlyReviewError(new Error("network unreachable"))).toBe(
    "Couldn't prepare this transfer. Try again.",
  );
  expect(friendlyReviewError("boom")).toBe("Couldn't prepare this transfer. Try again.");
});

test("labels a CSV export as device-records-only when on-chain history was unavailable", () => {
  // The export re-reads the feed, so its on-chain scan can degrade at export
  // time. A degraded export still downloads the local rows but must not read as
  // a complete-history success, or the user trusts a partial file as the whole
  // account history.
  const degraded = activityExportToast(true);
  expect(degraded.tone).toBe("error");
  expect(degraded.message).toContain("device's records only");

  const full = activityExportToast(false);
  expect(full).toEqual({ message: "Activity exported", tone: "success" });
});
