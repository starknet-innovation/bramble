/**
 * Spend caps are fixed. A displayed STRK fee and a gasless quote outside
 * them are refused, and the signature check looks for the VALID short string.
 */
import { describe, expect, test } from "bun:test";
import { buildErc20TransferCall, parseTokenAmount } from "@bramble/starknet/rpc";
import {
  canonicalFelt,
  isStarkFieldElement,
  STRK_TOKEN_ADDRESS,
  STRK_TOKEN_DECIMALS,
} from "@bramble/wallet-model/networks";
import {
  isValidSignatureCalldata,
  isValidSignatureResult,
  VALID_SIGNATURE,
} from "./local-mainnet-chain";
import {
  checkDisplayedStrkFee,
  gaslessOfferWithinCap,
  MAX_TX_FEE_STRK,
  SELF_TRANSFER_AMOUNT,
  selfTransferRaw,
} from "./local-mainnet-limits";

describe("local mainnet spend caps", () => {
  test("keeps the self-transfer at dust and the fee cap at 0.02 STRK", () => {
    expect(selfTransferRaw(STRK_TOKEN_DECIMALS)).toBe(
      parseTokenAmount(SELF_TRANSFER_AMOUNT, STRK_TOKEN_DECIMALS),
    );
    expect(selfTransferRaw(18)).toBe(1_000_000_000_000n);
    expect(parseTokenAmount(MAX_TX_FEE_STRK, STRK_TOKEN_DECIMALS)).toBe(20_000_000_000_000_000n);
  });

  test("accepts a STRK fee on the cap and refuses a larger one or a missing one", () => {
    expect(checkDisplayedStrkFee("Estimated fee: 0.02 STRK")).toEqual({
      kind: "ok",
      raw: 20_000_000_000_000_000n,
    });
    expect(checkDisplayedStrkFee("Estimated fee: 0.020001 STRK").kind).toBe("over");
    expect(checkDisplayedStrkFee("Estimating network fee…").kind).toBe("missing");
    expect(checkDisplayedStrkFee("Estimated fee: 1 WEI").kind).toBe("missing");
  });

  test("caps known gasless symbols and refuses STRK and unknown tokens", () => {
    expect(gaslessOfferWithinCap({ amount: "20000", decimals: 6, label: "USDC" })).toBe(true);
    expect(gaslessOfferWithinCap({ amount: "20001", decimals: 6, label: "USDC" })).toBe(false);
    expect(gaslessOfferWithinCap({ amount: "1", decimals: 18, label: "STRK" })).toBe(false);
    expect(gaslessOfferWithinCap({ amount: "1", decimals: 18, label: "OTHER" })).toBe(false);
    expect(gaslessOfferWithinCap({ amount: "0x10", decimals: 6, label: "USDC" })).toBe(false);
  });
});

describe("local mainnet transfer calldata", () => {
  test("builds a felt list the wallet can parse", () => {
    const call = buildErc20TransferCall(STRK_TOKEN_ADDRESS, "0x123", selfTransferRaw(18));
    expect(Array.isArray(call.calldata)).toBe(true);
    if (!Array.isArray(call.calldata)) {
      return;
    }
    expect(call.calldata.length).toBeGreaterThan(0);
    for (const felt of call.calldata) {
      const text =
        typeof felt === "string" || typeof felt === "bigint" || typeof felt === "number"
          ? String(felt)
          : "";
      const canonical = canonicalFelt(text);
      expect(canonical !== null && isStarkFieldElement(canonical)).toBe(true);
    }
  });
});

describe("local mainnet signature check", () => {
  test("builds is_valid_signature calldata and recognizes VALID", () => {
    expect(VALID_SIGNATURE).toBe("0x56414c4944");
    expect(isValidSignatureCalldata("0xabc", ["0x1", "0x2"])).toEqual([
      "0xabc",
      "0x2",
      "0x1",
      "0x2",
    ]);
    expect(isValidSignatureResult(["0x56414c4944"])).toBe(true);
    expect(isValidSignatureResult(["0x0"])).toBe(false);
  });
});
