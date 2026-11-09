/** The Home signability verdict is validated strictly before the flag renders. */
import { expect, test } from "bun:test";
import { isReadOnlyReason } from "@bramble/wallet-model/recovery";
import { isAccountSignabilityResponse } from "../../../src/popup/responses/responses";

test("accepts every read-only reason, including an undeployed Braavos account", () => {
  for (const reason of ["braavos", "undeployed", "guardian", "strong-signer"]) {
    expect(isReadOnlyReason(reason)).toBe(true);
    expect(
      isAccountSignabilityResponse({ accountId: "SN_MAIN:0x1", ok: true, readOnly: true, reason }),
    ).toBe(true);
  }
});

test("rejects an unknown reason, a missing reason, and a reason on a signable verdict", () => {
  expect(isReadOnlyReason("deploy")).toBe(false);
  expect(isAccountSignabilityResponse({ accountId: "SN_MAIN:0x1", ok: true, readOnly: true })).toBe(
    false,
  );
  expect(
    isAccountSignabilityResponse({
      accountId: "SN_MAIN:0x1",
      ok: true,
      readOnly: true,
      reason: "deploy",
    }),
  ).toBe(false);
  expect(
    isAccountSignabilityResponse({
      accountId: "SN_MAIN:0x1",
      ok: true,
      readOnly: false,
      reason: "undeployed",
    }),
  ).toBe(false);
});
