/**
 * Coverage for the pending-approval summary and risk-flag element guards inside
 * `isPendingApprovalsResponse`. An invoke prompt carries decoded call
 * `summaries` and risk `flags`; malformed elements in either array must make
 * the whole response fail validation, while well-formed ones pass.
 */
import { describe, expect, test } from "bun:test";
import { isPendingApprovalsResponse } from "../src/popup/approvals-responses";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const ORIGIN = "https://dapp.example";

const invoke = (extra: Record<string, unknown>) => ({
  ok: true,
  pending: [{ id: ID, kind: "invoke", origin: ORIGIN, ...extra }],
});

describe("pending-approval summary guard (isSummaryText)", () => {
  test("accepts an invoke prompt with well-formed decoded summaries", () => {
    expect(isPendingApprovalsResponse(invoke({ summaries: ["Transfer 5 tokens"] }))).toBe(true);
  });

  test("rejects summaries containing a non-string element", () => {
    expect(isPendingApprovalsResponse(invoke({ summaries: [123] }))).toBe(false);
  });

  test("rejects an empty-string summary", () => {
    expect(isPendingApprovalsResponse(invoke({ summaries: [""] }))).toBe(false);
  });

  test("rejects a summary longer than the 300-char cap", () => {
    expect(isPendingApprovalsResponse(invoke({ summaries: ["x".repeat(301)] }))).toBe(false);
  });
});

describe("pending-approval risk-flag guard (isApprovalRiskFlag)", () => {
  test("accepts an invoke prompt with a well-formed risk flag", () => {
    expect(
      isPendingApprovalsResponse(
        invoke({ flags: [{ code: "high-value", message: "Large transfer" }] }),
      ),
    ).toBe(true);
  });

  test("rejects a flag whose code breaks the lowercase-slug pattern", () => {
    expect(
      isPendingApprovalsResponse(invoke({ flags: [{ code: "BAD_CODE", message: "m" }] })),
    ).toBe(false);
  });

  test("rejects a flag with an empty message", () => {
    expect(isPendingApprovalsResponse(invoke({ flags: [{ code: "risk", message: "" }] }))).toBe(
      false,
    );
  });

  test("rejects a flag carrying unknown keys", () => {
    expect(
      isPendingApprovalsResponse(invoke({ flags: [{ code: "risk", extra: 1, message: "m" }] })),
    ).toBe(false);
  });

  test("rejects a non-record flag element", () => {
    expect(isPendingApprovalsResponse(invoke({ flags: [null] }))).toBe(false);
  });
});
