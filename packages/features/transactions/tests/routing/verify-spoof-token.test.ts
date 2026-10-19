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

// Dapp-added tokens (audit 171): trusted only when exactly curated, on every
// network; the spam heuristic alone cannot see a spoof where no curated ticker
// exists (Sepolia, devnet, uncurated mainnet tickers).
describe("dapp-added token trust (audit 171)", () => {
  const sepoliaAccount = { ...account, networkId: "SN_SEPOLIA" as const };
  const sepoliaStrkSpoof: TokenConfig = {
    ...spoof,
    decimals: 18,
    id: `SN_SEPOLIA:STRK:${SPOOF}`,
    name: "Starknet Token",
    networkId: "SN_SEPOLIA",
    symbol: "STRK",
  };
  const trusted = (
    target: Pick<AccountRef, "address" | "networkId">,
    tokens: readonly TokenConfig[],
    dappTokenIds: readonly string[],
  ) => verificationContext(target, { addressBook: [], dappTokenIds, tokens }).tokens;

  test("a dapp-added Sepolia token named STRK is not trusted", () => {
    expect(trusted(sepoliaAccount, [sepoliaStrkSpoof], [sepoliaStrkSpoof.id])).toEqual([]);
  });

  test("a token tracked on another network is not trusted", () => {
    expect(trusted(sepoliaAccount, [usdc], [])).toEqual([]);
  });

  test("the same token added by the user stays trusted", () => {
    expect(trusted(sepoliaAccount, [sepoliaStrkSpoof], [])).toEqual([sepoliaStrkSpoof]);
  });

  test("a dapp-added uncurated mainnet ticker is not trusted", () => {
    const lords = token(SPOOF, "LORDS", 18, "Lords");
    expect(trusted(account, [lords], [lords.id])).toEqual([]);
  });

  test("a dapp-added exact curated token stays trusted", () => {
    expect(trusted(account, [usdc], [usdc.id])).toEqual([usdc]);
  });

  test("a dapp-added curated contract under site-supplied decimals is not trusted", () => {
    const misdeclared = token(REAL_USDC, "USDC", 18, "USD Coin");
    expect(trusted(account, [misdeclared], [misdeclared.id])).toEqual([]);
  });

  test("a dapp-added default-tracked token stays trusted on Sepolia", () => {
    const sepoliaStrk: TokenConfig = {
      ...strk,
      id: `SN_SEPOLIA:STRK:${STRK_TOKEN_ADDRESS}`,
      name: "Sepolia Starknet Token",
      networkId: "SN_SEPOLIA",
    };
    expect(trusted(sepoliaAccount, [sepoliaStrk], [sepoliaStrk.id])).toEqual([sepoliaStrk]);
  });
});
