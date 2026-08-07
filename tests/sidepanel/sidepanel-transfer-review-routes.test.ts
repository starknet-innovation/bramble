/**
 * Route-keyed review blocks: the fee lines each route charges and the disclosure
 * of what it publishes on chain.
 */
import { describe, expect, test } from "bun:test";
import type { PrivacyPreparation } from "../../src/sidepanel/privacy-runtime";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import type { TransferFields } from "../../src/sidepanel/transfer-model";
import {
  routeDisclosureHtml,
  routeFeeHtml,
  routeReviewFeeHtml,
} from "../../src/sidepanel/transfer-review-routes";
import { preparationFor, type TransferReview } from "../../src/sidepanel/transfer-submit";
import { routeFor } from "../../src/starknet/send-routes";

const SENDER = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RECIPIENT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

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
  test("names the movement and what stays confidential on an unshield", () => {
    expect(routeDisclosureHtml(routeFor("private", "public"))).toContain(
      "You are sending from a private balance to a public balance. Sender address is confidential. Amount and recipient address are public.",
    );
  });

  test("names the movement and what stays confidential on a shield", () => {
    expect(routeDisclosureHtml(routeFor("public", "private"))).toContain(
      "You are sending from a public balance to a private balance. Recipient address is confidential. Sender address and amount are public.",
    );
  });

  test("reports a fully private transfer as exposing nothing", () => {
    const html = routeDisclosureHtml(routeFor("private", "private"));
    expect(html).toContain(
      "You are sending from a private balance to a private balance. Sender address, amount and recipient address are confidential.",
    );
    // Nothing is public, so no public clause is invented.
    expect(html).not.toContain("public.");
  });

  test("says so plainly when a public transfer hides nothing", () => {
    const html = routeDisclosureHtml(routeFor("public", "public"));
    expect(html).toContain(
      "You are sending from a public balance to a public balance. Sender address, amount and recipient address are public.",
    );
    expect(html).not.toContain("confidential");
  });

  test("renders in the fee line style, under the estimate", () => {
    // Same style as "Estimated fee" so the cost and its consequences read as one
    // block rather than as a warning bolted on.
    expect(routeDisclosureHtml(routeFor("private", "public"))).toContain('class="review-fee"');
  });

  test("pairs the fee lines with the disclosure in that order", () => {
    const html = routeReviewFeeHtml(routeFor("public", "public"), {
      preparation: null,
      review: review(),
    });
    expect(html.indexOf("Estimated fee:")).toBeLessThan(html.indexOf("You are sending from"));
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

describe("dispatch backstop", () => {
  const fields = (recipient: string): TransferFields =>
    ({
      amount: "1",
      destination: "private",
      recipient,
      source: "public",
      tokenId: "SN_MAIN:STRK:0x1",
    }) as TransferFields;

  test("refuses to shield to anyone but the sender instead of dropping the recipient", async () => {
    // preparePrivacyDeposit takes no recipient, so an unchecked call here shielded
    // to the sender while every screen reported a payment to the chosen account.
    let deposits = 0;
    const wallet = {
      preparePrivacyDeposit: async () => {
        deposits += 1;
        return {} as never;
      },
    } as unknown as SidepanelWallet;

    await expect(
      preparationFor(routeFor("public", "private"), fields(RECIPIENT), wallet, SENDER),
    ).rejects.toThrow("Shielding credits your own private balance");
    expect(deposits).toBe(0);
  });

  test("prepares the deposit when the recipient is the sender", async () => {
    let deposits = 0;
    const wallet = {
      preparePrivacyDeposit: async () => {
        deposits += 1;
        return {} as never;
      },
    } as unknown as SidepanelWallet;

    await preparationFor(routeFor("public", "private"), fields(SENDER), wallet, SENDER);
    expect(deposits).toBe(1);
  });
});
