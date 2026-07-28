/**
 * Spam heuristic fixes: legitimate same-symbol redeploys are allowlisted so
 * they are not mislabelled (A-M6), and confusable folding now catches ASCII
 * letter homoglyphs like VV->W and V->U (A-L9).
 */
import { describe, expect, test } from "bun:test";
import { type SpamCandidate, tokenSpamReasons } from "../../src/starknet/token-registry";

// Must match the USDC alias registered in src/starknet/token-registry.ts.
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
