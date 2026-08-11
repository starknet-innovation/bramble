/**
 * Popup action parser checks reject ambiguous DOM dataset values.
 */
import { describe, expect, test } from "bun:test";
import { readApprovalAction } from "../../../src/popup/actions";

describe("popup action parsers", () => {
  test("reads explicit approval actions only", () => {
    expect(readApprovalAction("approve")).toBe("approve");
    expect(readApprovalAction("deny")).toBe("deny");
    expect(readApprovalAction("")).toBeNull();
    expect(readApprovalAction("approved")).toBeNull();
    expect(readApprovalAction(undefined)).toBeNull();
  });
});
