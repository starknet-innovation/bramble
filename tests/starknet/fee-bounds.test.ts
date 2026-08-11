/**
 * MCW-V09-119: the pure half of binding a reviewed fee to a signed one.
 *
 * `exceedsReviewedFee` answers one question — has the cost outrun the consent —
 * and the submit boundary fails closed on a `true`. That makes every "I cannot
 * tell" case load-bearing: an unparseable figure or a mismatched denomination
 * must answer `true`, because a predicate that returns `false` when it could not
 * compare reads to its caller as "checked, and fine".
 *
 * `isFeeEstimate` is the one grammar for the shape, shared by the pages that
 * render a fee and the background that accepts one echoed back. If the two ever
 * disagreed, a fee one side rendered would be a fee the other silently dropped —
 * and a dropped ceiling is an unbound submission that looks bound.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  authorizedSpendFor,
  exceedsReviewedFee,
  feeBoundsMaxSpend,
  isFeeEstimate,
  nodeFeeEstimate,
  REVIEWED_FEE_HEADROOM,
  reviewedSpendFor,
} from "@mc-wallet/starknet/fee-bounds";
import { isFeeShape } from "../../packages/presentation/wallet-ui/src/popup/responses/responses-transfer";
import { REPO_DIR, repoRelative, workspaceSourceFiles } from "../support/workspace-sources";

const fri = (overallFee: string) => ({ overallFee, unit: "FRI" });

describe("exceedsReviewedFee", () => {
  test("accepts a quote at or under the reviewed figure", () => {
    expect(exceedsReviewedFee(fri("1000"), fri("1000"))).toBe(false);
    expect(exceedsReviewedFee(fri("1000"), fri("1"))).toBe(false);
  });

  test("accepts exactly the headroom and refuses one unit past it", () => {
    const ceiling =
      (1000n * BigInt(REVIEWED_FEE_HEADROOM.numerator)) / BigInt(REVIEWED_FEE_HEADROOM.denominator);
    expect(exceedsReviewedFee(fri("1000"), fri(ceiling.toString()))).toBe(false);
    expect(exceedsReviewedFee(fri("1000"), fri((ceiling + 1n).toString()))).toBe(true);
  });

  test("refuses an unlimited rise, which is the whole of the exposure", () => {
    expect(exceedsReviewedFee(fri("1000"), fri("1000000000000000000000"))).toBe(true);
  });

  test("refuses rather than compares across denominations", () => {
    expect(exceedsReviewedFee(fri("1000"), { overallFee: "1000", unit: "WEI" })).toBe(true);
    expect(exceedsReviewedFee({ overallFee: "1000", unit: "WEI" }, fri("1000"))).toBe(true);
  });

  test("refuses when either figure cannot be read as base units", () => {
    expect(exceedsReviewedFee(fri("1.5"), fri("1000"))).toBe(true);
    expect(exceedsReviewedFee(fri("1000"), fri("0x3e8"))).toBe(true);
    expect(exceedsReviewedFee(fri(""), fri("1"))).toBe(true);
  });

  test("treats a reviewed zero as consent to nothing", () => {
    expect(exceedsReviewedFee(fri("0"), fri("1"))).toBe(true);
    expect(exceedsReviewedFee(fri("0"), fri("0"))).toBe(false);
  });
});

describe("isFeeEstimate", () => {
  test("accepts the two denominations a Starknet estimate is reported in", () => {
    expect(isFeeEstimate(fri("1000"))).toBe(true);
    expect(isFeeEstimate({ overallFee: "1000", unit: "WEI" })).toBe(true);
  });

  test("refuses an unknown unit, a non-integer fee, and an extra key", () => {
    expect(isFeeEstimate({ overallFee: "1000", unit: "STRK" })).toBe(false);
    expect(isFeeEstimate({ overallFee: "1000", unit: "fri" })).toBe(false);
    expect(isFeeEstimate({ overallFee: "1.5", unit: "FRI" })).toBe(false);
    expect(isFeeEstimate({ overallFee: "1000", padding: "x", unit: "FRI" })).toBe(false);
    expect(isFeeEstimate(null)).toBe(false);
  });

  test("is the same predicate the extension pages validate a rendered fee with", () => {
    // One definition, checked from both doors: a divergence here is how a page
    // ends up rendering a fee the background will not accept back.
    for (const candidate of [
      fri("1000"),
      { overallFee: "1000", unit: "STRK" },
      { overallFee: "-1", unit: "FRI" },
      {},
    ]) {
      expect(isFeeShape(candidate)).toBe(isFeeEstimate(candidate));
    }
  });
});

// A node estimate in the shape starknet.js hands back: a headline figure plus
// the bounds a signature would actually carry. The two are the same quantity —
// 15x3 + 150x3 + 1500x1 = 1995 — which is exactly why a lane that scales the
// bounds after reading the headline has stopped telling the truth.
const nodeEstimate = {
  overall_fee: 1995n,
  resourceBounds: {
    l1_data_gas: { max_amount: 15n, max_price_per_unit: 3n },
    l1_gas: { max_amount: 150n, max_price_per_unit: 3n },
    l2_gas: { max_amount: 1500n, max_price_per_unit: 1n },
  },
  unit: "FRI",
};

describe("feeBoundsMaxSpend", () => {
  test("sums what the bounds authorise, across whatever resources they name", () => {
    expect(feeBoundsMaxSpend(nodeEstimate.resourceBounds)).toBe(1995n);
    // Structural, not a fixed list of resource names: a spec revision that adds
    // a resource must be counted, not silently dropped from the total.
    expect(
      feeBoundsMaxSpend({
        l2_gas: { max_amount: "0x10", max_price_per_unit: "2" },
        some_future_gas: { max_amount: 3n, max_price_per_unit: 5n },
      }),
    ).toBe(47n);
  });

  test("answers null rather than a partial total it cannot stand behind", () => {
    expect(feeBoundsMaxSpend(undefined)).toBeNull();
    expect(feeBoundsMaxSpend({})).toBeNull();
    expect(feeBoundsMaxSpend({ l2_gas: { max_amount: 1n } })).toBeNull();
    expect(feeBoundsMaxSpend({ l2_gas: { max_amount: "ten", max_price_per_unit: 1n } })).toBeNull();
    expect(feeBoundsMaxSpend({ l2_gas: 5n })).toBeNull();
  });
});

describe("authorizedSpendFor", () => {
  test("is the headline figure at standard speed", () => {
    expect(authorizedSpendFor(nodeEstimate, "standard")).toEqual(fri("1995"));
  });

  test("is the SCALED bounds at fast speed, not the estimate they came from", () => {
    // Both dimensions are scaled, so the authority rises by the square of the
    // scale: 22x4 + 225x4 + 2250x1 = 3238 against a headline of 1995. A ceiling
    // checked against 1995 would be checking a number this lane never signs.
    expect(authorizedSpendFor(nodeEstimate, "fast")).toEqual(fri("3238"));
    expect(exceedsReviewedFee(fri("1995"), fri("3238"))).toBe(true);
  });

  test("answers null when it cannot say what the signature would authorise", () => {
    expect(authorizedSpendFor({ overall_fee: 1995n, unit: "FRI" }, "standard")).toBeNull();
  });
});

describe("nodeFeeEstimate", () => {
  test("reads the node's figure into the shape the wallet validates", () => {
    expect(nodeFeeEstimate(nodeEstimate)).toEqual(fri("1995"));
    expect(nodeFeeEstimate({ overall_fee: "0x10" })).toEqual(fri("16"));
    expect(isFeeEstimate(nodeFeeEstimate(nodeEstimate))).toBe(true);
  });

  test("refuses a denomination at the producing end, where isFeeEstimate refuses it", () => {
    // The two ends share one allowlist on purpose. A unit that only the reader
    // rejects means a page renders a review the background will not accept back
    // — the fee silently stops being a ceiling somewhere in between.
    expect(() => nodeFeeEstimate({ overall_fee: 1n, unit: "GWEI" })).toThrow("unrecognised unit");
    expect(isFeeEstimate({ overallFee: "1", unit: "GWEI" })).toBe(false);
  });
});

describe("reviewedSpendFor", () => {
  test("shows the figure the submission will be held to, per speed", () => {
    expect(reviewedSpendFor(nodeEstimate, "standard")).toEqual(fri("1995"));
    expect(reviewedSpendFor(nodeEstimate, "fast")).toEqual(fri("3238"));
  });

  test("still states a figure when the bounds cannot be read, and states it high", () => {
    // A review has to show something. The fallback is the stated approximation
    // — the scale squared — and never the unscaled figure, which would under-
    // report what a fast send signs for.
    const boundless = { overall_fee: 1000n, unit: "FRI" };
    expect(reviewedSpendFor(boundless, "standard")).toEqual(fri("1000"));
    expect(reviewedSpendFor(boundless, "fast")).toEqual(fri("2250"));
  });
});

describe("the fee shape has one definition", () => {
  test("no module redeclares it structurally", async () => {
    // Nine private copies of `{ overallFee, unit }` once shadowed this type
    // across the popup, the panel, and the deployment surface. They are not
    // harmless duplication: a reviewed fee is carried across four layers as a
    // ceiling, and a layer that describes the shape itself is a layer that can
    // quietly stop meaning the same thing by it.
    const definition = join(REPO_DIR, "packages/platform/starknet/src/rpc/fee-bounds.ts");
    const offenders: string[] = [];
    for (const file of workspaceSourceFiles()) {
      if (file === definition) {
        continue;
      }
      if (/readonly\s+overallFee\s*:\s*string/.test(await readFile(file, "utf8"))) {
        offenders.push(repoRelative(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
