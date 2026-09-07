/**
 * Receive tells an unregistered account that it can only be paid publicly, and
 * routes activation through the same registration entry as the home asset rows.
 * The claim is only made on a settled reading: an in-flight or failed discovery
 * must not assert a registration state the wallet has not confirmed.
 */
import { describe, expect, test } from "bun:test";
import { account } from "@bramble/testkit/sidepanel";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { privacyPoolNotice } from "../../../../src/sidepanel/journeys/send/receive-view";

const settled = (registration: "registered" | "unregistered"): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: {
    accountId: account.id,
    balances: [],
    networkId: "SN_MAIN",
    poolFeeFri: "0x1",
    relayConfigured: true,
    registration,
  },
});

const NOTICE = "Public transfers only";

describe("receive privacy-pool notice", () => {
  test("an unregistered account gets a concise public-only state and recovery", () => {
    const html = privacyPoolNotice(settled("unregistered"));

    expect(html).toContain(NOTICE);
    expect(html).toContain("Enable private balances to receive privately.");
    expect(html).toContain("Enable privacy");
    // The whole notice is the control, and it reuses the home registration hook
    // so both surfaces reach the identical review.
    expect(html).toContain('data-privacy-register=""');
    expect(html).toContain('type="button"');
  });

  test("a registered account sees nothing", () => {
    expect(privacyPoolNotice(settled("registered"))).toBe("");
  });

  test("an unfunded account is told why, with nothing to click", () => {
    // Registration is an on-chain transaction: with no STRK it can only produce
    // a failed fee estimate, so no control is offered.
    const html = privacyPoolNotice(settled("unregistered"), "fund-first");

    expect(html).toContain(NOTICE);
    expect(html).toContain("Deploy this account and add STRK");
    expect(html).not.toContain("data-privacy-register");
    expect(html).not.toContain("Enable privacy");
    expect(html).not.toContain("<button");
  });

  test("a funded but undeployed account is offered deploy-then-register", () => {
    const html = privacyPoolNotice(settled("unregistered"), "deploy-first");

    expect(html).toContain('data-privacy-deploy-register=""');
    expect(html).toContain("Deploy and enable");
    // The copy is honest that this is two transactions: Starknet cannot batch a
    // DEPLOY_ACCOUNT with an invoke.
    expect(html).toContain("two transactions: deploy, then register");
    // It must not also carry the plain registration hook, or one click would
    // start both journeys.
    expect(html).not.toContain('data-privacy-register=""');
  });

  test("an unsettled or failed discovery makes no claim either way", () => {
    expect(privacyPoolNotice({ error: null, loading: true, value: null })).toBe("");
    expect(privacyPoolNotice({ error: null, loading: false, value: null })).toBe("");
    expect(
      privacyPoolNotice({ error: "strk20 services unavailable", loading: false, value: null }),
    ).toBe("");
  });
});
