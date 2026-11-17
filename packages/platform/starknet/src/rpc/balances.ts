/**
 * ERC20 amount conversion and public balance reads over Starknet RPC.
 */
import { WalletError } from "@bramble/core/errors";
import { isDecimalAmountText, isSafeDecimals } from "@bramble/core/json";
import { isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { CallData, type RpcProvider } from "starknet";
import { isTransportRpcError, withRpcFallback } from "./provider";
import { decodeUint256Response } from "./rpc-assets";
import type { TokenBalance } from "./token-balance";

/**
 * Inputs for reading tracked ERC20 balances.
 *
 * `isolateTokenFailures` is for display reads only. When it is set, a token
 * whose own read fails with a contract or decode error is left out of the
 * result so the other balances still arrive (Sherlock audit 134). Transport errors
 * still throw so endpoint fallback works, and if every token fails the first
 * error is thrown. Leave it unset wherever a missing balance must mean "could
 * not confirm": fee guards, privacy spend checks, onboarding and Ledger.
 */
export type BalanceInput = {
  readonly accountAddress: string;
  readonly isolateTokenFailures?: boolean;
  readonly rpcUrls: readonly string[];
  readonly tokens: readonly TokenConfig[];
};

const pow10 = (decimals: number): bigint => 10n ** BigInt(decimals);

/**
 * Parses a decimal token amount into raw integer ERC20 units. The terminal
 * consumer of every amount the reader boundaries admit, so it applies their
 * grammars (`isDecimalAmountText`, `isSafeDecimals`) rather than its own copies.
 * Throws {@link WalletError} on a value either rule rejects, on more fraction
 * digits than the token has, and on a non-positive result.
 */
export const parseTokenAmount = (amount: string, decimals: number): bigint => {
  const trimmed = amount.trim();
  if (!isSafeDecimals(decimals) || !isDecimalAmountText(trimmed)) {
    throw new WalletError("Invalid transfer amount");
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new WalletError("Too many decimal places");
  }
  const raw = BigInt(whole) * pow10(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n) {
    throw new WalletError("Transfer amount must be greater than zero");
  }
  return raw;
};

/**
 * Formats raw integer ERC20 units into a decimal display string.
 */
export const formatTokenAmount = (raw: bigint, decimals: number): string => {
  const base = pow10(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
};

const parseUint256Response = (response: readonly string[]): bigint => {
  const value = decodeUint256Response(response);
  if (value === null) {
    throw new WalletError("Invalid token balance response");
  }
  return value;
};

const BALANCE_READ_CONCURRENCY = 4;

type TokenRead = { readonly balance: TokenBalance } | { readonly error: unknown };

const readTokenBalance = async (
  provider: RpcProvider,
  accountAddress: string,
  token: TokenConfig,
): Promise<TokenBalance> => {
  const response = await provider.callContract(
    {
      calldata: CallData.compile([accountAddress]),
      contractAddress: token.address,
      entrypoint: "balanceOf",
    },
    "latest",
  );
  const balance = parseUint256Response(response);
  return {
    ...token,
    balance: balance.toString(),
    formatted: formatTokenAmount(balance, token.decimals),
  };
};

// Transport faults always propagate so `withRpcFallback` can try the next
// endpoint; only a node's answer about this one token is caught.
const isolatedRead = async (
  provider: RpcProvider,
  accountAddress: string,
  token: TokenConfig,
): Promise<TokenRead> => {
  try {
    return { balance: await readTokenBalance(provider, accountAddress, token) };
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return { error };
  }
};

const readAllIsolated = async (
  provider: RpcProvider,
  accountAddress: string,
  tokens: readonly TokenConfig[],
): Promise<readonly TokenBalance[]> => {
  const reads: TokenRead[] = [];
  for (let index = 0; index < tokens.length; index += BALANCE_READ_CONCURRENCY) {
    reads.push(
      ...(await Promise.all(
        tokens
          .slice(index, index + BALANCE_READ_CONCURRENCY)
          .map((token) => isolatedRead(provider, accountAddress, token)),
      )),
    );
  }
  const balances = reads.flatMap((read) => ("balance" in read ? [read.balance] : []));
  const firstFailure = reads.find((read) => "error" in read);
  // Nothing read at all looks like a node problem, not one bad token, so it
  // fails like an unisolated read instead of reporting an empty portfolio.
  if (balances.length === 0 && firstFailure && "error" in firstFailure) {
    throw firstFailure.error;
  }
  return balances;
};

/**
 * Reads ERC20 balances through Starknet RPC, at most
 * `BALANCE_READ_CONCURRENCY` calls at a time. By default any failed token
 * rejects the whole read; see {@link BalanceInput} for the isolated mode.
 */
export const getTokenBalances = async (
  { accountAddress, isolateTokenFailures = false, rpcUrls, tokens }: BalanceInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<readonly TokenBalance[]> => {
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid account address");
  }
  return withRpcFallback(
    rpcUrls,
    async (provider) => {
      if (isolateTokenFailures) {
        return readAllIsolated(provider, accountAddress, tokens);
      }
      const balances: TokenBalance[] = [];
      for (let index = 0; index < tokens.length; index += BALANCE_READ_CONCURRENCY) {
        balances.push(
          ...(await Promise.all(
            tokens
              .slice(index, index + BALANCE_READ_CONCURRENCY)
              .map((token) => readTokenBalance(provider, accountAddress, token)),
          )),
        );
      }
      return balances;
    },
    makeProvider,
  );
};
