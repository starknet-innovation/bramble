/**
 * The activity-feed, allowances, and deployment-status response validators
 * reject malformed background data before it reaches the popup: each guard's
 * true path plus every false/edge arm (bad ok flag, non-array payload, invalid
 * item, wrong-typed optional field, unknown key).
 */
import { describe, expect, test } from "bun:test";
import {
  isActivityResponse,
  isAllowancesResponse,
  isDeploymentStatusResponse,
  isTransactionAlertsResponse,
} from "../../src/popup/responses";
import {
  MAX_TRANSACTION_ALERT_CHARACTERS,
  MAX_TRANSACTION_ALERTS_PER_DRAIN,
} from "../../src/shared/transaction-alerts";

const activityEntry = {
  accountId: "SN_MAIN:0x123",
  hash: "0xabc",
  kind: "transfer" as const,
  networkId: "SN_MAIN" as const,
  status: "accepted" as const,
  submittedAt: 1000,
  summary: "Sent 1 ETH",
};

const allowanceView = {
  accountId: "SN_MAIN:0x1234567890abcdef",
  amount: "1000",
  id: "SN_MAIN:0x1234567890abcdef:0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7:0x5abcdef",
  networkId: "SN_MAIN" as const,
  source: "wallet" as const,
  spender: "0x5abcdef",
  token: "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
};

describe("isActivityResponse", () => {
  test("accepts a well-formed feed, with and without the degraded flag", () => {
    expect(isActivityResponse({ activity: [activityEntry], ok: true })).toBe(true);
    expect(isActivityResponse({ activity: [], historyUnavailable: true, ok: true })).toBe(true);
  });

  test("rejects a missing ok flag, non-array activity, and invalid entries", () => {
    expect(isActivityResponse({ activity: [activityEntry], ok: false })).toBe(false);
    expect(isActivityResponse({ activity: "nope", ok: true })).toBe(false);
    expect(isActivityResponse({ activity: [{ ...activityEntry, kind: "swap" }], ok: true })).toBe(
      false,
    );
  });

  test("rejects a non-boolean degraded flag and unknown keys", () => {
    expect(isActivityResponse({ activity: [], historyUnavailable: "yes", ok: true })).toBe(false);
    expect(isActivityResponse({ activity: [], debug: true, ok: true })).toBe(false);
    expect(isActivityResponse(null)).toBe(false);
  });
});

describe("isAllowancesResponse", () => {
  test("accepts a well-formed allowance list", () => {
    expect(isAllowancesResponse({ allowances: [allowanceView], ok: true })).toBe(true);
    expect(isAllowancesResponse({ allowances: [], ok: true })).toBe(true);
  });

  test("accepts a lower-bound allowance and rejects any other marking", () => {
    // MCW-V09-108: a record the wallet can only bound from below must survive
    // the message boundary, or the manager silently shows nothing for exactly
    // the allowances it is least sure about. Only `true` is representable, so
    // "exact" has one spelling.
    expect(
      isAllowancesResponse({ allowances: [{ ...allowanceView, lowerBound: true }], ok: true }),
    ).toBe(true);
    expect(
      isAllowancesResponse({ allowances: [{ ...allowanceView, lowerBound: false }], ok: true }),
    ).toBe(false);
    expect(
      isAllowancesResponse({ allowances: [{ ...allowanceView, lowerBound: "yes" }], ok: true }),
    ).toBe(false);
  });

  test("rejects a bad ok flag, a non-array payload, and invalid views", () => {
    expect(isAllowancesResponse({ allowances: [allowanceView], ok: false })).toBe(false);
    expect(isAllowancesResponse({ allowances: {}, ok: true })).toBe(false);
    expect(
      isAllowancesResponse({ allowances: [{ ...allowanceView, source: "elsewhere" }], ok: true }),
    ).toBe(false);
    expect(isAllowancesResponse({ allowances: [allowanceView], debug: 1, ok: true })).toBe(false);
  });
});

describe("isDeploymentStatusResponse", () => {
  test("accepts a well-formed deployment status", () => {
    expect(
      isDeploymentStatusResponse({ accountId: "SN_MAIN:0x123", deployed: true, ok: true }),
    ).toBe(true);
  });

  test("rejects a bad account id, a non-boolean deployed flag, and a false ok", () => {
    expect(
      isDeploymentStatusResponse({ accountId: "not-an-account", deployed: true, ok: true }),
    ).toBe(false);
    expect(
      isDeploymentStatusResponse({ accountId: "SN_MAIN:0x123", deployed: "yes", ok: true }),
    ).toBe(false);
    expect(
      isDeploymentStatusResponse({ accountId: "SN_MAIN:0x123", deployed: true, ok: false }),
    ).toBe(false);
  });
});

describe("isTransactionAlertsResponse", () => {
  test("accepts a bounded list and rejects oversized payloads", () => {
    expect(isTransactionAlertsResponse({ alerts: ["Transaction reverted"], ok: true })).toBe(true);
    expect(
      isTransactionAlertsResponse({
        alerts: Array.from({ length: MAX_TRANSACTION_ALERTS_PER_DRAIN + 1 }, () => "failure"),
        ok: true,
      }),
    ).toBe(false);
    expect(
      isTransactionAlertsResponse({
        alerts: ["x".repeat(MAX_TRANSACTION_ALERT_CHARACTERS + 1)],
        ok: true,
      }),
    ).toBe(false);
  });
});
