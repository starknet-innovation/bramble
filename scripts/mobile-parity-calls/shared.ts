/** Values every block of the call-review fixture shares (see `./index.ts`). All made up. */
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import type { Call } from "starknet";

export const ACCOUNT = "0x7e00d496e324876bbc8531f2d9a82bf154d1a04a50218ee74cdd372f75a551a";
export const OWN_ACCOUNT = "0x1a2b8e31f6e39c2f0d06a6b2ff4c1ad5a5d0b4f9e3a7c1d2e4f6a8b0c2d4e6f";
export const CONTACT = "0x5c3f9b0d1e2a4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c9a1";
/** Mimics `CONTACT`: the same `0x5c3f…c9a1` it renders as, a different account. */
export const CONTACT_TWIN = "0x5c3f000000000000000000000000000000000000000000000000000000c9a1";
/** Mimics `OWN_ACCOUNT` (`0x1a2b…4e6f`). */
export const OWN_TWIN = "0x1a2b11111111111111111111111111111111111111111111111111111114e6f";
export const PAID = "0x6d4e2c0a8b6f4d2e0c8a6b4f2d0e8c6a4b2f0d8e6c4a2b0f8d6e4c2a0b8f6d1";
/** Mimics `PAID` (`0x6d4e…f6d1`). */
export const PAID_TWIN = "0x6d4e9999999999999999999999999999999999999999999999999999999f6d1";
export const RECIPIENT = "0x3b7e5d1f9a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4";
export const SPENDER = "0x2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1";
export const ROUTER = "0x4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3";
export const NFT = "0x63c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c";
export const UNKNOWN = "0x2d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8";
export const OTHER_UNKNOWN = "0x1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0";
/** A curated mainnet token (USDC) the account does not track: still a token contract. */
export const USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";

export const ONE_AND_A_HALF = "1500000000000000000";
export const U128_MAX = `0x${"f".repeat(32)}`;
export const HALF_U128 = `0x8${"0".repeat(31)}`;

/** `STRK` and `ETH` on `networkId`, as the extension's preferences track them. */
export const trackedTokens = (networkId: StarknetNetworkId): readonly TokenConfig[] =>
  DEFAULT_TOKENS.filter((token) => token.networkId === networkId).map((token) => ({
    ...token,
    id: `${networkId}:${token.address}`,
  }));

const token = (symbol: string): string => {
  const found = DEFAULT_TOKENS.find((entry) => entry.symbol === symbol);
  if (!found) throw new Error(`no ${symbol}`);
  return found.address;
};
export const STRK = token("STRK");
export const ETH = token("ETH");

/** One call, its calldata (decimal or hex) as the hex felt strings a provider request carries. */
export const call = (
  contractAddress: string,
  entrypoint: string,
  calldata: readonly (string | number)[],
): Call => ({
  calldata: calldata.map((felt) => `0x${BigInt(felt).toString(16)}`),
  contractAddress,
  entrypoint,
});

/**
 * An AVNU `multi_route_swap` span: sell, buy, floor, beneficiary, integrator fee, then one route
 * whose parameter span is `params`. `extra` felts after it break the exact-length rule.
 */
export const avnuRoute = (
  sellToken: string,
  buyToken: string,
  beneficiary: string,
  extra: readonly string[] = [],
): string[] => [
  sellToken,
  ONE_AND_A_HALF,
  "0",
  buyToken,
  "2000000",
  "0",
  "1980000",
  "0",
  beneficiary,
  "0",
  "0",
  "1",
  sellToken,
  buyToken,
  ROUTER,
  "1000000000000",
  "1",
  "42",
  ...extra,
];
