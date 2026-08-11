/**
 * Token registry and spam heuristic checks.
 */
import { describe, expect, test } from "bun:test";
import {
  isLikelySpam,
  knownTokensForNetwork,
  type SpamCandidate,
  tokenSpamReasons,
} from "@mc-wallet/portfolio/token-registry";

const USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const USDC_E = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

describe("knownTokensForNetwork", () => {
  test("returns curated mainnet tokens with derived ids", () => {
    const tokens = knownTokensForNetwork("SN_MAIN");
    const usdc = tokens.find((token) => token.symbol === "USDC");
    expect(usdc?.address).toBe(USDC);
    expect(usdc?.decimals).toBe(6);
    expect(usdc?.id).toBe(`SN_MAIN:USDC:${USDC}`);
    expect(tokens.find((token) => token.symbol === "USDC.e")?.address).toBe(USDC_E);
    expect(tokens.map((token) => token.symbol)).toContain("WBTC");
  });

  test("has no curated tokens on test networks yet", () => {
    expect(knownTokensForNetwork("SN_SEPOLIA")).toEqual([]);
    expect(knownTokensForNetwork("SN_DEVNET")).toEqual([]);
  });
});

describe("tokenSpamReasons", () => {
  const legit: SpamCandidate = {
    address: USDC,
    decimals: 6,
    name: "USD Coin",
    networkId: "SN_MAIN",
    symbol: "USDC",
  };

  test("clears a genuine registry token", () => {
    expect(tokenSpamReasons(legit)).toEqual([]);
    expect(isLikelySpam(legit)).toBe(false);
  });

  test("flags a registry symbol borrowed by a different contract", () => {
    expect(tokenSpamReasons({ ...legit, address: "0xdead", name: "Fake USD Coin" })).toContain(
      "symbol-spoof",
    );
    expect(isLikelySpam({ ...legit, address: "0xdead" })).toBe(true);
  });

  test("folds confusable glyphs so 5TRK reads as STRK", () => {
    expect(
      tokenSpamReasons({
        address: "0xbeef",
        decimals: 18,
        name: "Airdrop",
        networkId: "SN_MAIN",
        symbol: "5TRK",
      }),
    ).toContain("symbol-spoof");
  });

  test("does not flag the real STRK contract as spoofing itself", () => {
    expect(
      tokenSpamReasons({
        address: STRK,
        decimals: 18,
        name: "Starknet Token",
        networkId: "SN_MAIN",
        symbol: "STRK",
      }),
    ).toEqual([]);
  });

  test("flags absurd decimals and empty names", () => {
    expect(
      tokenSpamReasons({
        address: "0xabc",
        decimals: 30,
        name: "Weird",
        networkId: "SN_MAIN",
        symbol: "WEIRD",
      }),
    ).toContain("absurd-decimals");
    expect(
      tokenSpamReasons({
        address: "0xabc",
        decimals: 18,
        name: "   ",
        networkId: "SN_MAIN",
        symbol: "GHOST",
      }),
    ).toContain("empty-name");
  });
});
