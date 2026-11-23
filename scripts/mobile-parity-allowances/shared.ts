/** Values every block of the allowances fixture shares (see `./index.ts`). All made up. */
import type { AllowanceRecord } from "@bramble/transactions/allowance-store";
import type { TokenConfig } from "@bramble/wallet-model/preferences";

export const NETWORK = "SN_MAIN" as const;
export const ADDRESS = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3";
export const ACCOUNT_ID = `${NETWORK}:${ADDRESS}`;
const MULTISIG_ADDRESS = "0x2b1d7c3e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a";
export const MULTISIG_ID = `${NETWORK}:${MULTISIG_ADDRESS}`;
export const OTHER_ID = `${NETWORK}:0x6d1c2b3a49586776859a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091`;

export const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const USDC = "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
// A contract the wallet neither tracks as a token nor watches as a collection.
export const UNKNOWN = "0x6a3c9f0e1d2b4a5c6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
export const NFT = "0x1f2e3d4c5b6a79881726354453627180f9e8d7c6b5a49382716051f2e3d4c5b";

export const DEX = "0xa11ce";
export const BRIDGE = "0xb0b";
export const LENDER = "0xc0ffee";

export const HASH = "0x5c2b9cd7d7e5a3f0b6fdb1b3a7ac2d3b4d5e6f708192a3b4c5d6e7f8091a2b3";
export const OTHER_HASH = "0x7e1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e7f809";

// 2^128 - 1, the unlimited cut-off, and 2^256 - 1, the largest uint256.
export const UNLIMITED = ((1n << 128n) - 1n).toString();
export const UINT256_MAX = ((1n << 256n) - 1n).toString();
// The field prime P is 2^251 + 17 * 2^192 + 1.
export const FIELD_PRIME = `0x800000000000011${"0".repeat(47)}1`;

const token = (address: string, symbol: string, decimals: number): TokenConfig => ({
  address,
  decimals,
  id: `${NETWORK}:${symbol}`,
  name: symbol,
  networkId: NETWORK,
  symbol,
});

/** The tokens the account trusts: STRK (18 decimals) and USDC (6). */
const TOKENS: readonly TokenConfig[] = [token(STRK, "STRK", 18), token(USDC, "USDC", 6)];

/** What the account trusts, as `approvedAssetKind` reads it; the JSON the fixture records. */
export const ASSETS = { nftContracts: [NFT], tokens: TOKENS } as const;

/** A stored record as the log writes it, for `accountId` (canonical token and spender). */
export const record = (
  tokenAddress: string,
  spender: string,
  amount: string,
  extra: Partial<Pick<AllowanceRecord, "lowerBound" | "revokeHash" | "revoking">> = {},
  accountId: string = ACCOUNT_ID,
): AllowanceRecord => ({
  accountId,
  amount,
  id: `${accountId}:${tokenAddress}:${spender}`,
  networkId: NETWORK,
  spender,
  token: tokenAddress,
  ...extra,
});

/** JSON-clean: what a stored or recorded value is once written (no `undefined` keys). */
export const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
