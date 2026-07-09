/**
 * Send-form recipient validation proves malformed addresses are caught inline
 * before `reviewTransfer` runs, and that the background's developer error
 * string is mapped onto the same friendly message.
 */
import { expect, test } from "bun:test";

import { friendlyReviewError, recipientFieldError } from "../src/sidepanel/transfer-ui";

const INVALID_RECIPIENT_MESSAGE = "Enter a valid Starknet address.";

test("accepts well-formed Starknet field-element recipients", () => {
  expect(recipientFieldError("0x1")).toBeNull();
  expect(recipientFieldError(`0x${"0".repeat(63)}1`)).toBeNull();
});

test("rejects malformed recipients with an inline message", () => {
  expect(recipientFieldError("")).toBe(INVALID_RECIPIENT_MESSAGE);
  expect(recipientFieldError("not-an-address")).toBe(INVALID_RECIPIENT_MESSAGE);
  expect(recipientFieldError("0xABC")).toBe(INVALID_RECIPIENT_MESSAGE);
  expect(
    recipientFieldError("0x800000000000011000000000000000000000000000000000000000000000001"),
  ).toBe(INVALID_RECIPIENT_MESSAGE);
});

test("maps the background review error onto the friendly recipient message", () => {
  expect(friendlyReviewError(new Error("invalid transfer review request"))).toBe(
    INVALID_RECIPIENT_MESSAGE,
  );
});

test("passes other review errors through unchanged", () => {
  expect(friendlyReviewError(new Error("network unreachable"))).toBe("network unreachable");
  expect(friendlyReviewError("boom")).toBe("Transfer review failed");
});
