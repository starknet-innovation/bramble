/**
 * The bound a relay-quoted fee must satisfy before it is proved.
 *
 * These cases fix the security property that separates the two routes: STRK is
 * checked against the pool's own on-chain charge and trusts the relay for
 * nothing, while a converted token is admitted only under a ceiling derived
 * from a price the relay did not supply — and is refused outright when no such
 * price exists. A regression here is a silent drain of shielded balance, so
 * every way the reference can fail is enumerated rather than sampled.
 */
import { describe, expect, test } from "bun:test";
import {
  preferredStrk20FeeToken,
  resolveStrk20FeeBound,
  reviewedFeeCeiling,
  strk20SendFeeModel,
  withinFeeBound,
} from "@bramble/privacy/fee-bound";
import {
  STRK20_FEE_CEILING_MULTIPLIER,
  STRK20_FEE_UNVERIFIABLE,
  strk20ConvertedFeeCeiling,
} from "@bramble/privacy/fee-policy";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const networkId = "SN_MAIN" as const;
const POOL_FEE = 6_000_000_000_000_000_000n;

describe("resolveStrk20FeeBound", () => {
  test("binds the STRK route to the on-chain charge without consulting a price", async () => {
    let consulted = false;
    const bound = await resolveStrk20FeeBound({
      feeReference: async () => {
        consulted = true;
        return 1n;
      },
      feeToken: STRK_TOKEN_ADDRESS,
      networkId,
      poolFeeFri: POOL_FEE,
    });

    expect(bound).toEqual({ amount: POOL_FEE, kind: "exact" });
    expect(consulted).toBe(false);
  });

  test("matches STRK numerically, so a padded fee-token address stays exact", async () => {
    const bound = await resolveStrk20FeeBound({
      feeToken: `0x0${STRK_TOKEN_ADDRESS.slice(2)}`,
      networkId,
      poolFeeFri: POOL_FEE,
    });

    expect(bound.kind).toBe("exact");
  });

  test("derives a ceiling for a converted token from the reference", async () => {
    const bound = await resolveStrk20FeeBound({
      feeReference: async (input) => {
        expect(input).toEqual({ feeToken: USDC, networkId, poolFeeFri: POOL_FEE });
        return 1_200_000n;
      },
      feeToken: USDC,
      networkId,
      poolFeeFri: POOL_FEE,
    });

    expect(bound).toEqual({
      ceiling: 1_200_000n * STRK20_FEE_CEILING_MULTIPLIER,
      kind: "ceiling",
      reference: 1_200_000n,
    });
  });

  test.each([
    ["no reference collaborator is wired", undefined],
    ["the reference declines to price the token", async () => null],
    ["the reference returns a non-positive amount", async () => 0n],
    ["the reference returns a negative amount", async () => -1n],
    [
      "the reference throws",
      async () => {
        throw new Error("price feed offline");
      },
    ],
  ])("refuses a converted fee when %s", async (_case, feeReference) => {
    await expect(
      resolveStrk20FeeBound({
        ...(feeReference ? { feeReference } : {}),
        feeToken: USDC,
        networkId,
        poolFeeFri: POOL_FEE,
      }),
    ).rejects.toThrow(STRK20_FEE_UNVERIFIABLE);
  });
});

describe("withinFeeBound", () => {
  test("accepts only the exact charge on the STRK route", () => {
    const bound = { amount: 5n, kind: "exact" } as const;

    expect(withinFeeBound("0x5", bound)).toBe(true);
    // Padding is a felt spelling, not a different value.
    expect(withinFeeBound("0x005", bound)).toBe(true);
    expect(withinFeeBound("0x4", bound)).toBe(false);
    expect(withinFeeBound("0x6", bound)).toBe(false);
  });

  test("accepts at or below the ceiling and refuses a single unit above", () => {
    const bound = { ceiling: 100n, kind: "ceiling", reference: 50n } as const;

    expect(withinFeeBound("0x0", bound)).toBe(true);
    expect(withinFeeBound("0x63", bound)).toBe(true);
    expect(withinFeeBound("0x64", bound)).toBe(true);
    expect(withinFeeBound("0x65", bound)).toBe(false);
  });

  test("refuses an unparseable amount rather than admitting it", () => {
    expect(withinFeeBound("not-a-felt", { ceiling: 100n, kind: "ceiling", reference: 50n })).toBe(
      false,
    );
  });
});

describe("reviewedFeeCeiling", () => {
  test("records the converted bound so submission re-checks what was reviewed", () => {
    expect(reviewedFeeCeiling({ ceiling: 100n, kind: "ceiling", reference: 50n })).toEqual({
      feeCeiling: { ceiling: "0x64", reference: "0x32" },
    });
  });

  test("records nothing on the exact route, which has no band", () => {
    expect(reviewedFeeCeiling({ amount: 5n, kind: "exact" })).toEqual({});
  });
});

describe("strk20ConvertedFeeCeiling", () => {
  test("scales the reference by the single-sourced multiplier", () => {
    expect(strk20ConvertedFeeCeiling(1_000n)).toBe(1_000n * STRK20_FEE_CEILING_MULTIPLIER);
  });

  test("yields a zero ceiling for a non-positive reference, admitting nothing", () => {
    expect(strk20ConvertedFeeCeiling(0n)).toBe(0n);
    expect(strk20ConvertedFeeCeiling(-5n)).toBe(0n);
  });
});

/**
 * Which token the fee is quoted in before the relay answers. Following the
 * token being sent is what lets a shielded balance of one asset be spent
 * without holding a second; the fallback cases are the ones where that choice
 * would be ambiguous or would create a public linkage.
 */
describe("preferredStrk20FeeToken", () => {
  const transfer = (token: string) =>
    ({ amount: "0x1", recipient: "0x9", token, type: "transfer" }) as const;
  const withdraw = (token: string) =>
    ({ amount: "0x1", recipient: "0x9", token, type: "withdraw" }) as const;
  const deposit = (token: string) => ({ amount: "0x1", token, type: "deposit" }) as const;

  test("follows the single token a batch spends privately", () => {
    expect(preferredStrk20FeeToken([transfer(USDC)], STRK_TOKEN_ADDRESS)).toBe(USDC);
    expect(preferredStrk20FeeToken([withdraw(USDC)], STRK_TOKEN_ADDRESS)).toBe(USDC);
  });

  test("keeps following it across several actions in one token", () => {
    expect(
      preferredStrk20FeeToken([transfer(USDC), transfer(USDC), withdraw(USDC)], STRK_TOKEN_ADDRESS),
    ).toBe(USDC);
  });

  test("falls back when a batch spends more than one token", () => {
    expect(preferredStrk20FeeToken([transfer(USDC), transfer("0xabc")], STRK_TOKEN_ADDRESS)).toBe(
      STRK_TOKEN_ADDRESS,
    );
  });

  test("falls back when a batch spends nothing privately", () => {
    expect(preferredStrk20FeeToken([], STRK_TOKEN_ADDRESS)).toBe(STRK_TOKEN_ADDRESS);
    expect(preferredStrk20FeeToken([deposit(USDC)], STRK_TOKEN_ADDRESS)).toBe(STRK_TOKEN_ADDRESS);
  });

  // A fee withdrawal in a token the same transaction publicly deposits would
  // put a deposit and a withdrawal of one token on-chain together, which is the
  // linkage `assertNoPrivacyLeak` refuses for the user's own actions.
  test("falls back when the batch also deposits that token", () => {
    expect(preferredStrk20FeeToken([deposit(USDC), transfer(USDC)], STRK_TOKEN_ADDRESS)).toBe(
      STRK_TOKEN_ADDRESS,
    );
  });

  test("honours a configured fallback other than STRK", () => {
    expect(preferredStrk20FeeToken([], USDC)).toBe(USDC);
  });
});

/**
 * The fee token the Send affordability gate reserves against must match the one
 * the quote above selects, or the gate blocks a send the relay would accept, or
 * reserves the wrong balance.
 */
// A third token, neither STRK nor the configured fallback.
const OTHER = "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8";

describe("strk20SendFeeModel", () => {
  test("follows the sent token when a converted ceiling bounds the fee", () => {
    expect(
      strk20SendFeeModel({
        convertedCeiling: 7n,
        fallbackCeiling: null,
        fallbackFeeToken: STRK_TOKEN_ADDRESS,
        token: USDC,
      }),
    ).toEqual({ convertedCeiling: 7n, feeToken: USDC });
  });

  test("falls back to the fee token when the sent token is the fee token", () => {
    expect(
      strk20SendFeeModel({
        convertedCeiling: 7n,
        fallbackCeiling: null,
        fallbackFeeToken: STRK_TOKEN_ADDRESS,
        token: STRK_TOKEN_ADDRESS,
      }),
    ).toEqual({ convertedCeiling: null, feeToken: STRK_TOKEN_ADDRESS });
  });

  test("falls back when no independent reference bounds a conversion", () => {
    expect(
      strk20SendFeeModel({
        convertedCeiling: null,
        fallbackCeiling: null,
        fallbackFeeToken: STRK_TOKEN_ADDRESS,
        token: USDC,
      }),
    ).toEqual({ convertedCeiling: null, feeToken: STRK_TOKEN_ADDRESS });
  });

  test("honours a configured fallback other than STRK, with its own ceiling", () => {
    // An unpriced sent token falls back to a non-STRK fee token, so the gate
    // needs that token's own bound: a null here used to leave Send pending.
    expect(
      strk20SendFeeModel({
        convertedCeiling: null,
        fallbackCeiling: 9n,
        fallbackFeeToken: USDC,
        token: OTHER,
      }),
    ).toEqual({ convertedCeiling: 9n, feeToken: USDC });
  });

  test("sending STRK pays the exact STRK fee even with a non-STRK fallback", () => {
    // The quote prefers the sent token, and STRK needs no reference.
    expect(
      strk20SendFeeModel({
        convertedCeiling: null,
        fallbackCeiling: 9n,
        fallbackFeeToken: USDC,
        token: STRK_TOKEN_ADDRESS,
      }),
    ).toEqual({ convertedCeiling: null, feeToken: STRK_TOKEN_ADDRESS });
  });

  test("sending the non-STRK fee token itself reserves its own ceiling", () => {
    expect(
      strk20SendFeeModel({
        convertedCeiling: 9n,
        fallbackCeiling: 9n,
        fallbackFeeToken: USDC,
        token: USDC,
      }),
    ).toEqual({ convertedCeiling: 9n, feeToken: USDC });
  });

  test("an unpriceable non-STRK fallback leaves no bound for the gate to refuse on", () => {
    expect(
      strk20SendFeeModel({
        convertedCeiling: null,
        fallbackCeiling: null,
        fallbackFeeToken: USDC,
        token: OTHER,
      }),
    ).toEqual({ convertedCeiling: null, feeToken: USDC });
  });
});
