/**
 * Render-cache selectors. `verificationForActiveAccount` keys the on-chain
 * class-hash trust badge by the account it was computed for, so a stale result
 * from the previous account can never be shown against a freshly switched-to
 * account — the exact false-trust-signal the accountId keying prevents.
 */
import { describe, expect, test } from "bun:test";
import type { ClassHashVerificationResponse } from "../src/popup/responses";
import { verificationForActiveAccount } from "../src/sidepanel/render-cache";

const verified = (accountId: string): ClassHashVerificationResponse => ({
  accountId,
  ok: true,
  verification: { onChainClassHash: "0x2", status: "verified" },
});

describe("verificationForActiveAccount", () => {
  test("returns the verification when it was computed for the active account", () => {
    expect(verificationForActiveAccount(verified("SN_MAIN:0xA"), "SN_MAIN:0xA")).toEqual({
      onChainClassHash: "0x2",
      status: "verified",
    });
  });

  test("suppresses a verification computed for a DIFFERENT account (post-switch staleness)", () => {
    // Account A verified, user switches to B before B's round-trip lands: the
    // cached A result must not read as B's badge.
    expect(verificationForActiveAccount(verified("SN_MAIN:0xA"), "SN_MAIN:0xB")).toBeNull();
  });

  test("returns null when nothing is cached or no account is active", () => {
    expect(verificationForActiveAccount(null, "SN_MAIN:0xA")).toBeNull();
    expect(verificationForActiveAccount(verified("SN_MAIN:0xA"), null)).toBeNull();
  });
});
