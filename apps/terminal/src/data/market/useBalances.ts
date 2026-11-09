/**
 * useBalances — on-chain ERC20 balances for the connected address across the
 * tracked mainnet token set. For each token it issues a `starknet_call` to
 * `balanceOf(address)` (falling back to the snake_case `balance_of` entrypoint),
 * decodes the u256 low/high felt pair into a bigint, and formats it with the
 * token's decimals. Calls run in parallel through the shared RPC failover. A
 * token whose read fails fails the refresh (the last good balances stay on
 * screen with an error); only a successful contract response reads as zero.
 * With no address the hook returns an empty list (not an error).
 *
 * Latest-state RPC is the only source (#650): Starkscan retired its indexed
 * token-holdings snapshot (HTTP 410), and its successor wallet-state route
 * reads the same contracts over RPC, so a third party adds disclosure without
 * adding a balance the tracked-token read cannot see.
 */
import { useCallback } from "react";
import { CallData } from "starknet";
import type { RpcProvider } from "starknet";
import { withRpc } from "../core/client";
import { formatTokenAmount } from "../core/format";
import { KNOWN_TOKENS, type KnownToken } from "./knownTokens";
import type { Resource, TokenBalance } from "../core/types";
import { useAsyncResource } from "../core/useAsyncResource";
import { REQUEST_FAILED } from "../../protocols/support/user-error";

const POLL_MS = 30_000;
// The resource layer's existing generic failure text (useAsyncResource).
const BALANCES_UNAVAILABLE = REQUEST_FAILED;

// Decodes a balanceOf response (u256 as [low, high] felts) into a single bigint.
const decodeU256 = (response: readonly string[]): bigint => {
  const low = response[0] !== undefined ? BigInt(response[0]) : 0n;
  const high = response[1] !== undefined ? BigInt(response[1]) : 0n;
  return low + (high << 128n);
};

// Reads one token's balance, trying both entrypoint spellings. Only a
// successful contract response establishes a balance, zero included: when both
// spellings fail the read throws, so a transport error fails over to the next
// RPC endpoint and an unreadable token is never shown as an empty one.
const readBalance = async (
  provider: RpcProvider,
  token: KnownToken,
  address: string,
): Promise<bigint> => {
  const calldata = CallData.compile([address]);
  let lastError: unknown;
  for (const entrypoint of ["balanceOf", "balance_of"]) {
    try {
      const response = await provider.callContract(
        { calldata, contractAddress: token.address, entrypoint },
        "latest",
      );
      return decodeU256(response);
    } catch (cause) {
      lastError = cause;
    }
  }
  throw lastError;
};

// Any unreadable token fails the whole refresh: the resource then keeps the
// last good balances and reports an error instead of a zero it never read.
// The RPC detail stays out of the message the portfolio banner shows.
const fetchRpcBalances = async (address: string): Promise<readonly TokenBalance[]> =>
  withRpc(async (provider) =>
    Promise.all(
      KNOWN_TOKENS.map(async (token): Promise<TokenBalance> => {
        const raw = await readBalance(provider, token, address);
        const { display, amount } = formatTokenAmount(raw, token.decimals);
        return {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          raw,
          display,
          amount,
        };
      }),
    ),
  ).catch(() => {
    throw new Error(BALANCES_UNAVAILABLE);
  });

/**
 * On-chain balances for `address`. Returns an empty list (no error, no loading)
 * when disconnected.
 */
export const useBalances = (address: string | null): Resource<readonly TokenBalance[]> => {
  const fetcher = useCallback(
    async (): Promise<readonly TokenBalance[]> => {
      if (address === null) {
        return [];
      }
      return fetchRpcBalances(address);
    },
    [address],
  );

  return useAsyncResource(fetcher, [address ?? ""], POLL_MS);
};
