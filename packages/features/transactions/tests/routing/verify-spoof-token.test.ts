/**
 * Spoofed tokens are not trusted by the risk engine (audit 171): a tracked token
 * that borrows a known ticker from a different contract stays an unknown
 * contract and is summarized in raw units, whether it arrived by watchAsset or
 * was added by the user. Curated tokens are unaffected, even when hidden.
 */
import { describe, expect, test } from "bun:test";
import { verificationContext, verifyCalls } from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

const account: Pick<AccountRef, "address" | "networkId"> = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
};
const RECIPIENT = "0x0abc000000000000000000000000000000000000000000000000000000000def";
const REAL_USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const SPOOF = "0x0bad000000000000000000000000000000000000000000000000000000000001";

const token = (address: string, symbol: string, decimals: number, name: string): TokenConfig => ({
  address,
  decimals,
  id: `SN_MAIN:${address}`,
  name,
  networkId: "SN_MAIN",
  symbol,
});
const spoof = token(SPOOF, "USDC", 6, "USD Coin");
const usdc = token(REAL_USDC, "USDC", 6, "USD Coin");
const strk = token(STRK_TOKEN_ADDRESS, "STRK", 18, "Starknet Token");

const transfer = (contractAddress: string, amount: string) => ({
  calldata: [RECIPIENT, amount, "0x0"],
  contractAddress,
  entrypoint: "transfer",
});

const review = (tokens: readonly TokenConfig[], contractAddress: string, amount: string) =>
  verifyCalls(
    [transfer(contractAddress, amount)],
    verificationContext(account, { addressBook: [], tokens }),
  );

describe("spoofed token trust (audit 171)", () => {
  test("a tracked spoof is still an unknown contract, summarized in units", () => {
    const report = review([spoof], SPOOF, "0x3b9aca00");
    expect(report.flags.map((flag) => flag.code)).toContain("unknown-contract");
    expect(report.calls[0]?.summary).toContain("units");
    expect(report.calls[0]?.summary).not.toContain("USDC");
  });

  test("the curated contract is known and formatted", () => {
    const report = review([usdc, spoof], REAL_USDC, "0x3b9aca00");
    expect(report.flags.map((flag) => flag.code)).not.toContain("unknown-contract");
    expect(report.calls[0]?.summary).toContain("1000 USDC");
    expect(report.calls[0]?.summary).toContain("USDC");
  });

  test("curated STRK stays trusted (hidden tokens are not consulted)", () => {
    const report = review([strk], STRK_TOKEN_ADDRESS, "0xde0b6b3a7640000");
    expect(report.flags.map((flag) => flag.code)).not.toContain("unknown-contract");
    expect(report.calls[0]?.summary).toContain("STRK");
  });
});
