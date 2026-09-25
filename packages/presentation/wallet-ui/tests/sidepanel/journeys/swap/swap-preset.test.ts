/**
 * The pair a swap opens on when another screen chose the sell side. Pure, so
 * the choice is checked without the swap screen's module state.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { swapPresetPair } from "../../../../src/sidepanel/journeys/swap/swap-preset";

const token = (id: string, symbol: string): TokenConfig =>
  ({
    address: `0x${id}`,
    decimals: 18,
    id,
    name: symbol,
    networkId: "SN_MAIN",
    symbol,
  }) as TokenConfig;

const STRK = token("SN_MAIN:STRK", "STRK");
const ETH = token("SN_MAIN:ETH", "ETH");
const USDC = token("SN_MAIN:USDC", "USDC");

describe("swapPresetPair", () => {
  test("buys STRK with whatever was chosen", () => {
    expect(swapPresetPair(ETH.id, [ETH, STRK, USDC])).toEqual({
      buyId: STRK.id,
      sellId: ETH.id,
    });
    expect(swapPresetPair(USDC.id, [ETH, STRK, USDC])).toEqual({
      buyId: STRK.id,
      sellId: USDC.id,
    });
  });

  test("falls back to another token when STRK is the one being sold", () => {
    // STRK cannot be both sides, so the rule the screen already uses applies.
    expect(swapPresetPair(STRK.id, [STRK, ETH, USDC])).toEqual({
      buyId: ETH.id,
      sellId: STRK.id,
    });
  });

  test("refuses a token this network does not track", () => {
    // Seeding an untracked token would open the swap on a pair it cannot price.
    expect(swapPresetPair("SN_MAIN:NOPE", [STRK, ETH])).toBeNull();
  });

  test("leaves the buy side unset when nothing else is tracked", () => {
    expect(swapPresetPair(STRK.id, [STRK])).toEqual({ buyId: null, sellId: STRK.id });
  });
});
