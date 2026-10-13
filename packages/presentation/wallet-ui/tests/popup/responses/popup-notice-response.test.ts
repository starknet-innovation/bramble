/**
 * The private-services notice (#443) crosses the background-to-UI boundary as
 * a bare approval: no account context and no action review, because it binds
 * nothing and authorizes nothing.
 */
import { describe, expect, test } from "bun:test";
import { isPendingApprovalsResponse } from "../../../src/popup/responses/responses";

const approvalId = "123e4567-e89b-42d3-a456-426614174000";

describe("private-services notice response", () => {
  test("admits the private-services notice only without a context or action review", () => {
    const notice = { id: approvalId, kind: "strk20-unavailable", origin: "https://example.com" };
    expect(isPendingApprovalsResponse({ ok: true, pending: [notice] })).toBe(true);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          {
            ...notice,
            context: {
              accountId: "SN_SEPOLIA:0x1",
              chainId: "0x534e5f5345504f4c4941",
              networkId: "SN_SEPOLIA",
              payloadDigest: `sha256:${"a".repeat(64)}`,
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          { ...notice, actionReviews: [{ calldata: [], contract: "0x2", type: "invoke" }] },
        ],
      }),
    ).toBe(false);
  });

  test("admits a notice reason only on the notice, and only a known one", () => {
    const notice = { id: approvalId, kind: "strk20-unavailable", origin: "https://example.com" };
    for (const reason of ["record-limit"]) {
      expect(
        isPendingApprovalsResponse({ ok: true, pending: [{ ...notice, notice: reason }] }),
      ).toBe(true);
    }
    expect(isPendingApprovalsResponse({ ok: true, pending: [{ ...notice, notice: "x" }] })).toBe(
      false,
    );
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          { id: approvalId, kind: "connect", notice: "record-limit", origin: notice.origin },
        ],
      }),
    ).toBe(false);
  });
});
