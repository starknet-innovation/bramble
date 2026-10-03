/**
 * The fee-unit reading behind a reviewed fee value.
 *
 * Two rules carry the design: the stored choice decides which unit is shown,
 * and a fiat figure appears only while a fresh STRK price is on hand. The
 * second one is the safety property, so it is asserted from both sides — a
 * stale price and an absent one must both leave the exact STRK ceiling in
 * place rather than a guessed reference rate. The figures are round so the
 * fiat expectations do not depend on rounding.
 */
import { describe, expect, test } from "bun:test";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { reviewFeeSection } from "@bramble/wallet-ui/lab";
import {
  type FeeDisplay,
  feeDisplayFrom,
  feeValueHtml,
  feeValueText,
  STRK_ONLY,
  strkPriceFrom,
} from "../../../src/sidepanel/shared/fee-display";

/** 1 STRK, the base unit a fee is quoted in. */
const ONE_STRK = "1000000000000000000";
/** 0.0001 STRK: a fee small enough that its fiat reading collapses. */
const DUST = "100000000000000";

const strk = (price: number): FeeDisplay => ({ currency: "usd", strkPrice: price, unit: "strk" });
const fiat = (price: number, unit: "fiat" | "strk"): FeeDisplay => ({
  currency: "usd",
  strkPrice: price,
  unit,
});

describe("strkPriceFrom", () => {
  test("reads the STRK price out of the panel's price cache", () => {
    expect(strkPriceFrom({ [STRK_TOKEN_ADDRESS]: 2 }, false)).toBe(2);
  });

  test("matches the STRK address as a field element, not as text", () => {
    const padded = `0x${STRK_TOKEN_ADDRESS.replace(/^0x/, "").padStart(64, "0")}`;
    expect(strkPriceFrom({ [padded.toUpperCase().replace("0X", "0x")]: 3 }, false)).toBe(3);
  });

  test("fails closed on a stale price", () => {
    expect(strkPriceFrom({ [STRK_TOKEN_ADDRESS]: 2 }, true)).toBeNull();
  });

  test("ignores an absent, unusable, or non-positive figure", () => {
    expect(strkPriceFrom({}, false)).toBeNull();
    expect(strkPriceFrom({ [STRK_TOKEN_ADDRESS]: Number.NaN }, false)).toBeNull();
    expect(strkPriceFrom({ [STRK_TOKEN_ADDRESS]: 0 }, false)).toBeNull();
    expect(strkPriceFrom({ [STRK_TOKEN_ADDRESS]: -1 }, false)).toBeNull();
  });
});

describe("feeDisplayFrom", () => {
  test("defaults to the exact STRK reading with no price context", () => {
    expect(feeDisplayFrom(undefined, {}, false)).toEqual({
      currency: "usd",
      strkPrice: null,
      unit: "strk",
    });
  });

  test("carries the stored unit, currency, and fresh price", () => {
    expect(
      feeDisplayFrom(
        { displayCurrency: "gbp", feeDisplayUnit: "fiat" },
        { [STRK_TOKEN_ADDRESS]: 2 },
        false,
      ),
    ).toEqual({ currency: "gbp", strkPrice: 2, unit: "fiat" });
  });

  test("drops the price when it is stale, so a stored fiat choice cannot show one", () => {
    const display = feeDisplayFrom({ feeDisplayUnit: "fiat" }, { [STRK_TOKEN_ADDRESS]: 2 }, true);
    expect(display.unit).toBe("fiat");
    expect(display.strkPrice).toBeNull();
  });
});

describe("feeValueText", () => {
  test("names the fiat figure when a fresh price exists", () => {
    expect(feeValueText(fiat(2, "fiat"), ONE_STRK)).toBe("$2.00");
  });

  test("collapses a fee too small to show, rather than rounding it to nothing", () => {
    expect(feeValueText(fiat(2, "fiat"), DUST)).toBe("$<0.01");
  });

  test("falls back to the exact STRK ceiling when the price is gone", () => {
    expect(feeValueText({ currency: "usd", strkPrice: null, unit: "fiat" }, ONE_STRK)).toBe(
      "1 STRK",
    );
  });

  test("still reads STRK when the chosen unit is STRK", () => {
    expect(feeValueText(strk(2), ONE_STRK)).toBe("1 STRK");
  });

  test("an unparseable amount yields the text it was given, never a fiat figure", () => {
    expect(feeValueText(fiat(2, "fiat"), "not-a-number")).toBe("not-a-number");
  });
});

describe("feeValueHtml", () => {
  test("renders plain STRK text with no affordance when no price makes fiat possible", () => {
    expect(feeValueHtml(STRK_ONLY, ONE_STRK, "Estimated fee")).toBe("1 STRK");
  });

  test("keeps the exact STRK ceiling beside the fiat figure while fiat is showing", () => {
    const html = feeValueHtml(fiat(2, "fiat"), ONE_STRK, "Estimated fee");
    expect(html).toContain("data-fee-toggle");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("$2.00 (1 STRK)");
    expect(html).toContain("activate to show in STRK");
  });

  test("offers the fiat reading from the STRK view, naming the action and the figure", () => {
    const html = feeValueHtml(strk(2), ONE_STRK, "Estimated fee");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">1 STRK</button>");
    expect(html).toContain("Estimated fee 1 STRK, activate to show in USD");
  });

  test("escapes the accessible name it builds", () => {
    const html = feeValueHtml(strk(2), ONE_STRK, 'Fee "quoted"');
    expect(html).toContain("&quot;quoted&quot;");
  });
});

describe("review fee section", () => {
  const fri = { fee: { overallFee: ONE_STRK, unit: "FRI" as const }, feeEstimateFailed: false };

  test("makes the estimate tappable once a fresh price makes a fiat reading possible", () => {
    const html = reviewFeeSection(fri, { id: "retry" }, { display: strk(2) });
    expect(html).toContain("Estimated fee: <button");
    expect(html).toContain("data-fee-toggle");
  });

  test("leaves the estimate exactly as before when no price is available", () => {
    const html = reviewFeeSection(fri, { id: "retry" });
    expect(html).toContain("Estimated fee: 1 STRK");
    expect(html).not.toContain("data-fee-toggle");
  });

  test("never relabels another unit: a WEI estimate stays plain text", () => {
    const html = reviewFeeSection(
      { fee: { overallFee: "1", unit: "WEI" }, feeEstimateFailed: false },
      { id: "retry" },
      { display: fiat(2, "fiat") },
    );
    expect(html).toContain("Estimated fee: 1 WEI");
    expect(html).not.toContain("data-fee-toggle");
  });
});
