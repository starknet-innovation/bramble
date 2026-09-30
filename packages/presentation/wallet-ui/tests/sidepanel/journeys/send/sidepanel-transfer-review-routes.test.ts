/**
 * Route-keyed review blocks: the fee lines each route charges and the disclosure
 * of what it publishes on chain.
 */
import { describe, expect, test } from "bun:test";
import { routeFor } from "@bramble/transactions/send-routes";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import type { TransferFields } from "../../../../src/sidepanel/journeys/send/transfer-model";
import {
  routeDisclosureHtml,
  routeFeeHtml,
  routeReviewFeeHtml,
} from "../../../../src/sidepanel/journeys/send/transfer-review-routes";
import {
  preparationFor,
  type TransferReview,
} from "../../../../src/sidepanel/journeys/send/transfer-submit";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";

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

const accountPreparation = (): PrivacyPreparation =>
  ({
    amount: "1",
    id: `sha256:${"1".repeat(64)}`,
    kind: "deposit",
    payloadDigest: `sha256:${"1".repeat(64)}`,
    poolAddress: "0x1",
    poolFeeFri: POOL_FEE,
    recipient: RECIPIENT,
    route: "public-account",
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

  test("a deposit names the pool charge beside the network fee", () => {
    // Both leave the public balance in the same transaction, so both are shown.
    const html = routeFeeHtml(routeFor("public", "private"), {
      poolFeeFri: POOL_FEE,
      preparation: accountPreparation(),
      review: review(),
    });
    expect(html).toContain("Estimated fee:");
    expect(html).toContain("Pool fee: 6 STRK");
  });

  // A deposit's gas is not knowable at review time — the proof, and so the
  // calldata being estimated, is built at submission — but the line is still
  // present, because "Estimated fee" means the same thing on all four routes.
  test("a deposit still shows a network fee line with no estimate to give", () => {
    const html = routeFeeHtml(routeFor("public", "private"), {
      poolFeeFri: POOL_FEE,
      preparation: accountPreparation(),
      review: review({ fee: null }),
    });
    expect(html).toContain("Estimated fee: charged at submission");
    expect(html).toContain("Pool fee: 6 STRK");
  });

  test("a deposit omits the pool line when the fee has not been read", () => {
    const html = routeFeeHtml(routeFor("public", "private"), {
      preparation: null,
      review: review(),
    });
    expect(html).toContain("Estimated fee:");
    expect(html).not.toContain("Pool fee:");
  });

  test("a relayed route reports sponsored gas and the pool charge it withdraws", () => {
    const html = routeFeeHtml(routeFor("private", "public"), {
      poolFeeFri: POOL_FEE,
      preparation: relayed(),
      review: review(),
    });
    // Gas is the paymaster's; the pool's charge is named as such rather than
    // billed as network gas.
    expect(html).toContain("Estimated fee: Sponsored");
    // The relay's recipient address is not a cost the reader decides on.
    expect(html).not.toContain("Relay fee recipient");
    expect(html).toContain("Pool fee: 6 STRK");
  });

  test("every route leads with a network fee line", () => {
    for (const [source, destination] of [
      ["private", "private"],
      ["private", "public"],
      ["public", "private"],
      ["public", "public"],
    ] as const) {
      const html = routeFeeHtml(routeFor(source, destination), {
        poolFeeFri: POOL_FEE,
        preparation: source === "private" ? relayed() : null,
        review: review(),
      });
      expect(html).toContain("Estimated fee:");
    }
  });

  // Cost and Visibility are two answers, so the review draws two boxes. Only
  // the account route's estimate came through the shared section, which meant
  // a relayed or deposit route showed bare fee lines beside a boxed
  // Visibility.
  test("every route puts its fees in the Cost box", () => {
    for (const [source, destination] of [
      ["private", "private"],
      ["private", "public"],
      ["public", "private"],
      ["public", "public"],
    ] as const) {
      const label = `${source} to ${destination}`;
      for (const state of [
        { poolFeeFri: POOL_FEE, preparation: relayed(), review: review() },
        // No estimate to section: a deposit is priced at submission.
        { poolFeeFri: POOL_FEE, preparation: relayed(), review: null },
      ]) {
        const html = routeFeeHtml(routeFor(source, destination), {
          ...state,
          preparation: source === "private" ? state.preparation : null,
        });
        expect(html, label).toContain('aria-label="Cost"');
        expect(html, label).toContain('class="decision-label">Cost<');
      }
    }
  });

  test("adds the two fees up when a route charges both", () => {
    // 6 STRK pool charge over a 0.01 STRK network fee.
    const shield = routeFeeHtml(routeFor("public", "private"), {
      poolFeeFri: POOL_FEE,
      preparation: accountPreparation(),
      review: review(),
    });
    expect(shield).toContain("Estimated fee:");
    expect(shield).toContain("Pool fee: 6 STRK");
    expect(shield).toContain("Total: 6.01 STRK");

    // A relayed route builds its own lines and totals the same pair. The
    // shared fixture withdraws exactly the pool charge, which is the sponsored
    // case, so this one keeps 0.01 STRK above it.
    const withCut = {
      ...relayed(),
      relayFee: {
        amount: `0x${(BigInt(POOL_FEE) + BigInt("0x2386f26fc10000")).toString(16)}`,
        recipient: "0x2",
        token: "0x3",
      },
    } as PrivacyPreparation;
    const unshield = routeFeeHtml(routeFor("private", "public"), {
      poolFeeFri: POOL_FEE,
      preparation: withCut,
      review: review(),
    });
    expect(unshield).toContain("Estimated fee: 0.01 STRK");
    expect(unshield).toContain("Pool fee: 6 STRK");
    expect(unshield).toContain("Total: 6.01 STRK");

    // Sponsored gas costs the pool charge and nothing else, so no total.
    const sponsored = routeFeeHtml(routeFor("private", "public"), {
      poolFeeFri: POOL_FEE,
      preparation: relayed(),
      review: review(),
    });
    expect(sponsored).toContain("Sponsored");
    expect(sponsored).not.toContain("Total:");
  });

  test("states no total when there is only one fee to state", () => {
    // A public transfer pays network gas alone, so a total would repeat it.
    const html = routeFeeHtml(routeFor("public", "public"), {
      preparation: null,
      review: review(),
    });
    expect(html).toContain("Estimated fee:");
    expect(html).not.toContain("Total:");
  });

  test("pairs a boxed Cost with a boxed Visibility", () => {
    const html = routeReviewFeeHtml(routeFor("public", "public"), {
      preparation: null,
      review: review(),
    });
    expect((html.match(/class="decision-layer/g) ?? []).length).toBe(2);
    expect(html.indexOf('aria-label="Cost"')).toBeLessThan(html.indexOf('aria-label="Visibility"'));
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

describe("deposit dispatch", () => {
  const ACCOUNT_ID = `SN_MAIN:${SENDER}`;

  const fields = (recipient: string): TransferFields =>
    ({
      accountId: ACCOUNT_ID,
      amount: "1",
      destination: "private",
      recipient,
      source: "public",
      tokenAddress: "0x1",
      tokenId: "SN_MAIN:STRK:0x1",
    }) as TransferFields;

  // The deposit is now reached through the shared recipient check, so the stub
  // answers the two reads it makes. Neither recipient here resembles a trusted
  // address (shielding to self is an exact match, not a lookalike), so the
  // check passes and the dispatch is what these assert.
  const recordingWallet = (): {
    readonly deposits: readonly (readonly string[])[];
    readonly wallet: SidepanelWallet;
  } => {
    const deposits: string[][] = [];
    return {
      deposits,
      wallet: {
        loadPreferences: async () => ({ addressBook: [], tokens: [] }),
        loadStatus: async () => ({
          accounts: [{ address: SENDER, id: ACCOUNT_ID, networkId: "SN_MAIN" }],
          networkId: "SN_MAIN",
        }),
        preparePrivacyDeposit: async (tokenId: string, amount: string, recipient: string) => {
          deposits.push([tokenId, amount, recipient]);
          return {} as never;
        },
      } as unknown as SidepanelWallet,
    };
  };

  // The composed recipient must reach the deposit rather than being dropped: a
  // deposit that ignored it credited the sender while the screens reported a
  // payment to the chosen account.
  test("passes a third-party recipient through to the deposit", async () => {
    const { deposits, wallet } = recordingWallet();

    await preparationFor(routeFor("public", "private"), fields(RECIPIENT), wallet);

    expect(deposits).toEqual([["SN_MAIN:STRK:0x1", "1", RECIPIENT]]);
  });

  test("passes the sender through unchanged when shielding to self", async () => {
    const { deposits, wallet } = recordingWallet();

    await preparationFor(routeFor("public", "private"), fields(SENDER), wallet);

    expect(deposits).toEqual([["SN_MAIN:STRK:0x1", "1", SENDER]]);
  });
});
