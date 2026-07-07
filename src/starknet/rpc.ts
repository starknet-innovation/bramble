/**
 * Starknet RPC wallet operations backed by starknet-js and Krusty signatures.
 */
import { type Account, type Call, CallData, cairo } from "starknet";
import { WalletError } from "../shared/errors";
import { isRecord } from "../shared/json";
import type { TokenConfig } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { ensureAccountDeployed } from "./deployment";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "./networks";
import {
  isTransportRpcError,
  krustyAccount,
  type StarkHashSigner,
  withRpcFallback,
} from "./provider";

/**
 * Re-exported counterfactual deployment operations.
 */
export {
  type AccountDeployment,
  type DeployAccountInput,
  type DeploymentStatusInput,
  type DeploySubmission,
  getDeploymentStatus,
  ozAccountDeployment,
  submitAccountDeployment,
} from "./deployment";
/**
 * Re-exported provider helpers so existing callers keep one import path.
 */
export {
  isContractNotFoundError,
  isTransportRpcError,
  type StarkHashSigner,
  withRpcFallback,
} from "./provider";

const UINT_128_SHIFT = 128n;

/**
 * Token balance returned to the side panel.
 */
export type TokenBalance = TokenConfig & {
  readonly balance: string;
  readonly formatted: string;
};

/**
 * ERC20 transfer submission result.
 */
export type TransferSubmission = {
  readonly call: Call;
  readonly transactionHash: string;
};

/**
 * Generic invoke submission result.
 */
export type InvokeSubmission = {
  readonly calls: readonly Call[];
  readonly transactionHash: string;
};

/**
 * Inputs for reading tracked ERC20 balances.
 */
export type BalanceInput = {
  readonly accountAddress: string;
  readonly rpcUrls: readonly string[];
  readonly tokens: readonly TokenConfig[];
};

/**
 * Inputs for submitting one ERC20 transfer.
 */
export type TransferInput = {
  readonly account: AccountRef;
  readonly amount: string;
  readonly recipient: string;
  readonly rpcUrls: readonly string[];
  readonly signHash: StarkHashSigner;
  readonly speed?: FeeSpeed;
  readonly token: TokenConfig;
};

/**
 * Inputs for submitting one or more invoke calls.
 */
export type InvokeInput = {
  readonly account: AccountRef;
  readonly calls: readonly Call[];
  readonly rpcUrls: readonly string[];
  readonly signHash: StarkHashSigner;
  readonly speed?: FeeSpeed;
};

/**
 * Fee speed control: standard uses node defaults, fast scales estimated
 * resource bounds up for faster inclusion.
 */
export type FeeSpeed = "fast" | "standard";

/**
 * Fee estimate returned before signing.
 */
export type FeeEstimate = {
  readonly overallFee: string;
  readonly unit: string;
};

/**
 * Inputs for reading transaction statuses.
 */
export type TransactionStatusInput = {
  readonly hashes: readonly string[];
  readonly rpcUrls: readonly string[];
};

/**
 * Chain-derived transaction status used by the activity feed.
 */
export type TransactionStatus = "accepted" | "pending" | "rejected" | "reverted";

const pow10 = (decimals: number): bigint => 10n ** BigInt(decimals);

/**
 * Parses a decimal token amount into raw integer ERC20 units.
 */
export const parseTokenAmount = (amount: string, decimals: number): bigint => {
  const trimmed = amount.trim();
  if (
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 36 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(trimmed)
  ) {
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
  const low = response[0];
  const high = response[1];
  if (
    typeof low !== "string" ||
    typeof high !== "string" ||
    !isStarkFieldElement(low) ||
    !isStarkFieldElement(high)
  ) {
    throw new WalletError("Invalid token balance response");
  }
  return BigInt(low) + (BigInt(high) << UINT_128_SHIFT);
};

/**
 * Builds an ERC20 transfer call without signing or broadcasting it.
 */
export const buildErc20TransferCall = (
  tokenAddress: string,
  recipient: string,
  amountRaw: bigint,
): Call => {
  if (!isNonZeroStarkFieldElement(tokenAddress) || !isNonZeroStarkFieldElement(recipient)) {
    throw new WalletError("Invalid transfer address");
  }
  return {
    calldata: CallData.compile([recipient, cairo.uint256(amountRaw)]),
    contractAddress: tokenAddress,
    entrypoint: "transfer",
  };
};

/**
 * Reads ERC20 balances through Starknet RPC.
 */
export const getTokenBalances = async ({
  accountAddress,
  rpcUrls,
  tokens,
}: BalanceInput): Promise<readonly TokenBalance[]> => {
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid account address");
  }
  return withRpcFallback(rpcUrls, async (provider) => {
    const balances = await Promise.all(
      tokens.map(async (token) => {
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
      }),
    );
    return balances;
  });
};

/**
 * Signs and submits an ERC20 transfer through an account contract.
 */
export const submitErc20Transfer = async ({
  account,
  amount,
  recipient,
  rpcUrls,
  signHash,
  speed,
  token,
}: TransferInput): Promise<TransferSubmission> => {
  const amountRaw = parseTokenAmount(amount, token.decimals);
  const call = buildErc20TransferCall(token.address, recipient, amountRaw);
  const result = await submitInvokeTransaction({
    account,
    calls: [call],
    rpcUrls,
    signHash,
    ...(speed === undefined ? {} : { speed }),
  });
  return {
    call,
    transactionHash: result.transactionHash,
  };
};

const scaledBounds = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return (value * 3n) / 2n;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, scaledBounds(entry)]),
    );
  }
  if (typeof value === "string" && /^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    const scaled = (BigInt(value) * 3n) / 2n;
    return value.startsWith("0x") ? `0x${scaled.toString(16)}` : scaled.toString();
  }
  return value;
};

/**
 * Estimates the fee for invoke calls without broadcasting anything.
 */
export const estimateInvokeFee = async ({
  account,
  calls,
  rpcUrls,
  signHash,
}: InvokeInput): Promise<FeeEstimate> => {
  if (calls.length === 0) {
    throw new WalletError("No calls to estimate");
  }
  return withRpcFallback(rpcUrls, async (provider) => {
    const starknetAccount = krustyAccount(provider, account, signHash);
    const estimate = await starknetAccount.estimateInvokeFee([...calls]);
    return {
      overallFee: BigInt(estimate.overall_fee).toString(),
      unit: typeof estimate.unit === "string" ? estimate.unit : "FRI",
    };
  });
};

/**
 * Reads finality/execution status for submitted transactions.
 */
export const getTransactionStatuses = async ({
  hashes,
  rpcUrls,
}: TransactionStatusInput): Promise<Readonly<Record<string, TransactionStatus>>> =>
  withRpcFallback(rpcUrls, async (provider) => {
    const entries = await Promise.all(
      hashes.map(async (transactionHash): Promise<readonly [string, TransactionStatus]> => {
        try {
          const status = await provider.getTransactionStatus(transactionHash);
          const finality = String(status.finality_status ?? "");
          const execution = String(status.execution_status ?? "");
          if (execution === "REVERTED") {
            return [transactionHash, "reverted"];
          }
          if (finality === "REJECTED") {
            return [transactionHash, "rejected"];
          }
          if (finality === "ACCEPTED_ON_L2" || finality === "ACCEPTED_ON_L1") {
            return [transactionHash, "accepted"];
          }
          return [transactionHash, "pending"];
        } catch (error) {
          if (isTransportRpcError(error)) {
            throw error;
          }
          return [transactionHash, "pending"];
        }
      }),
    );
    return Object.fromEntries(entries);
  });

/**
 * Signs and submits generic Starknet invoke calls through an account contract,
 * deploying the counterfactual account first when this is its first
 * transaction. `speed: "fast"` scales estimated resource bounds up 1.5x.
 */
export const submitInvokeTransaction = async ({
  account,
  calls,
  rpcUrls,
  signHash,
  speed = "standard",
}: InvokeInput): Promise<InvokeSubmission> => {
  if (calls.length === 0) {
    throw new WalletError("No calls to submit");
  }
  return withRpcFallback(rpcUrls, async (provider) => {
    const starknetAccount = krustyAccount(provider, account, signHash);
    await ensureAccountDeployed(provider, starknetAccount, account);
    const details =
      speed === "fast"
        ? {
            resourceBounds: scaledBounds(
              (await starknetAccount.estimateInvokeFee([...calls])).resourceBounds,
            ),
          }
        : {};
    const result = await starknetAccount.execute(
      [...calls],
      details as Parameters<Account["execute"]>[1],
    );
    return {
      calls,
      transactionHash: result.transaction_hash,
    };
  });
};
