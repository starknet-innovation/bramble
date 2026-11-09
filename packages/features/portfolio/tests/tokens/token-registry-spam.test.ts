/**
 * Spam heuristic fixes: legitimate same-symbol redeploys are allowlisted so
 * they are not mislabelled (A-M6), and confusable folding now catches ASCII
 * letter homoglyphs like VV->W and V->U (A-L9).
 */
import { describe, expect, test } from "bun:test";
import { type SpamCandidate, tokenSpamReasons } from "@bramble/portfolio/token-registry";

// Must match the USDC alias registered in the portfolio token registry.
const USDC_ALIAS = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

const candidate = (overrides: Partial<SpamCandidate>): SpamCandidate => ({
  address: "0xdead",
  decimals: 18,
  name: "Token",
  networkId: "SN_MAIN",
  symbol: "TOK",
  ...overrides,
});

describe("symbol-spoof allowlist", () => {
  test("does not flag an allowlisted alternate USDC deployment", () => {
    expect(
      tokenSpamReasons(
        candidate({ address: USDC_ALIAS, decimals: 6, name: "USD Coin", symbol: "USDC" }),
      ),
    ).not.toContain("symbol-spoof");
  });

  test("still flags a random different-address token borrowing USDC", () => {
    expect(
      tokenSpamReasons(
        candidate({ address: "0xbadc0de", decimals: 6, name: "USD Coin", symbol: "USDC" }),
      ),
    ).toContain("symbol-spoof");
  });
});

describe("confusable letter homoglyphs", () => {
  test("folds VV->W so VVBTC reads as WBTC", () => {
    expect(
      tokenSpamReasons(
        candidate({ address: "0xbeef", decimals: 8, name: "Airdrop", symbol: "VVBTC" }),
      ),
    ).toContain("symbol-spoof");
  });

  test("folds V->U so VSDC reads as USDC", () => {
    expect(
      tokenSpamReasons(
        candidate({ address: "0xbeed", decimals: 6, name: "Airdrop", symbol: "VSDC" }),
      ),
    ).toContain("symbol-spoof");
  });
});

// Issue 645: a bridged ticker carries one `.e` suffix, so the suffix must not
// let a dapp borrow a curated ticker past the spoof check.
describe("bridged .e suffix folding", () => {
  const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
  const USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";

  test("reads ETH.e as a spoof of ETH", () => {
    expect(tokenSpamReasons(candidate({ name: "Ether", symbol: "ETH.e" }))).toContain(
      "symbol-spoof",
    );
    // Confusable folding still applies under the suffix.
    expect(
      tokenSpamReasons(candidate({ address: "0xbeef", name: "Ether", symbol: "5TRK.e" })),
    ).toContain("symbol-spoof");
  });

  test("still reads a dotless USDCE as a spoof of USDC.e", () => {
    expect(tokenSpamReasons(candidate({ decimals: 6, symbol: "USDCE" }))).toContain("symbol-spoof");
    expect(tokenSpamReasons(candidate({ decimals: 6, symbol: "USDC.e" }))).toContain(
      "symbol-spoof",
    );
  });

  test("clears both curated USDC contracts under their own and each other's ticker", () => {
    for (const symbol of ["USDC", "USDC.e"]) {
      for (const address of [USDC, USDC_ALIAS]) {
        expect(
          tokenSpamReasons(candidate({ address, decimals: 6, name: "USD Coin", symbol })),
        ).not.toContain("symbol-spoof");
      }
    }
    expect(
      tokenSpamReasons(candidate({ address: ETH, decimals: 18, name: "Ether", symbol: "ETH" })),
    ).toEqual([]);
  });
});
