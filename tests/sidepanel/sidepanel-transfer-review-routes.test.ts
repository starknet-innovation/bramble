/**
 * Route-keyed review blocks: the fee lines each route charges and the disclosure
 * of what it publishes on chain.
 */
import { describe, expect, test } from "bun:test";
import type { PrivacyPreparation } from "../../src/sidepanel/privacy-runtime";
import { routeDisclosureHtml, routeFeeHtml } from "../../src/sidepanel/transfer-review-routes";
import type { TransferReview } from "../../src/sidepanel/transfer-submit";
import { routeFor } from "../../src/starknet/send-routes";

// 6 STRK: the mainnet pool's per-action charge.
const POOL_FEE = "0x53444835ec580000";

const review = (overrides: Partial<TransferReview> = {}): TransferReview =>
  ({
    fee: { overallFee: "0x2386f26fc10000", unit: "FRI" },
    feeAffordability: "ok",
    feeEstimateFailed: false,
    flags: [],
    requiresDeployment: false,
    summaries: [],
    ...overrides,
  }) as TransferReview;

const relayed = (): PrivacyPreparation =>
  ({
    id: `sha256:${"0".repeat(64)}`,
    kind: "transfer",
    payloadDigest: `sha256:${"0".repeat(64)}`,
    poolAddress: "0x1",
    relayFee: { amount: POOL_FEE, recipient: "0x2", token: "0x3" },
    route: "private-relay",
    summaries: [],
    symbol: "STRK",
    tokenId: "SN_MAIN:STRK:0x1",
  }) as PrivacyPreparation;

describe("route disclosure", () => {
  test("says a fully private transfer publishes nothing", () => {
    expect(routeDisclosureHtml(routeFor("private", "private"))).toContain(
      "Nothing about this transfer is published on Starknet.",
    );
  });

  test("names what a deposit exposes and what it does not", () => {
    const html = routeDisclosureHtml(routeFor("public", "private"));
    expect(html).toContain("Published on Starknet: your address and the amount.");
    // The credited note's owner stays inside the pool.
    expect(html).toContain("Not published: the recipient.");
  });

  test("names what a withdrawal exposes and what it does not", () => {
    const html = routeDisclosureHtml(routeFor("private", "public"));
    expect(html).toContain("Published on Starknet: the recipient and the amount.");
    expect(html).toContain("Not published: your address.");
  });

  test("stays silent on a plain public transfer", () => {
    // Everything about it has always been public; annotating the common case
    // would be noise rather than news.
    expect(routeDisclosureHtml(routeFor("public", "public"))).toBe("");
  });
});

describe("route fee lines", () => {
  test("a public transfer shows the network estimate alone", () => {
    const html = routeFeeHtml(routeFor("public", "public"), {
      poolFeeFri: POOL_FEE,
      preparation: null,
      review: review(),
    });
    expect(html).toContain("Estimated fee:");
    expect(html).not.toContain("pool fees");
  });

  test("a deposit adds the pool charge to the network estimate", () => {
    // Both leave the public balance in the same transaction, so both are shown.
    const html = routeFeeHtml(routeFor("public", "private"), {
      poolFeeFri: POOL_FEE,
      preparation: null,
      review: review(),
    });
    expect(html).toContain("Estimated fee:");
    expect(html).toContain("6 STRK is deducted from your public balance to cover pool fees");
  });

  test("a deposit omits the pool line when the fee has not been read", () => {
    const html = routeFeeHtml(routeFor("public", "private"), {
      preparation: null,
      review: review(),
    });
    expect(html).toContain("Estimated fee:");
    expect(html).not.toContain("pool fees");
  });

  test("a relayed route reports the split the relay actually withdraws", () => {
    const html = routeFeeHtml(routeFor("private", "public"), {
      poolFeeFri: POOL_FEE,
      preparation: relayed(),
      review: review(),
    });
    // The pool's charge is named as such rather than billed as the relay's price.
    expect(html).toContain("Pool fee: 6 STRK");
    expect(html).toContain("Relay fee: Sponsored");
    expect(html).not.toContain("Estimated fee:");
  });

  test("surfaces a failed estimate through the shared fee section", () => {
    const html = routeFeeHtml(routeFor("public", "public"), {
      preparation: null,
      review: review({ fee: null, feeEstimateFailed: true }),
    });
    expect(html).toContain("Couldn't estimate the network fee");
    expect(html).toContain("review-retry-fee");
  });
});
