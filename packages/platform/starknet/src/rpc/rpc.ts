/**
 * Starknet RPC wallet operations backed by starknet-js and Krusty signatures.
 */
import { WalletError } from "@mc-wallet/core/errors";
import { isDecimalAmountText, isSafeDecimals } from "@mc-wallet/core/json";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import type { TokenConfig } from "@mc-wallet/wallet-model/preferences";
import { type Call, CallData, cairo, type RpcProvider, shortString } from "starknet";
import type { FeeEstimate } from "./fee-bounds";
import {
  isTransactionNotFoundError,
  isTransportRpcError,
  type StarkHashSigner,
  withRpcFallback,
} from "./provider";
import { decodeUint256Response } from "./rpc-assets";
import { type FeeSpeed, type InvokeInput, submitInvokeTransaction } from "./rpc-submit";

/**
 * Re-exported declare-transaction submission so callers keep one RPC import path.
 */
export {
  type DeclareFeeEstimate,
  type DeclareInput,
  type DeclareSubmission,
  estimateDeclareFee,
  submitDeclareTransaction,
} from "../transactions/declare";
/**
 * Re-exported counterfactual deployment operations.
 */
export {
  type AccountDeployment,
  type AccountDeploymentFeeEstimate,
  accountDeployment,
  type DeployAccountInput,
  type DeploymentStatusInput,
  type DeploySubmission,
  estimateAccountDeploymentFee,
  getDeploymentStatus,
  submitAccountDeployment,
} from "../transactions/deployment";
/**
 * Re-exported provider helpers so existing callers keep one import path.
 */
export {
  IndeterminateRpcWriteError,
  isContractNotFoundError,
  isTransactionNotFoundError,
  isTransportRpcError,
  RPC_REFUSED_MESSAGE,
  RpcRefusedError,
  type StarkHashSigner,
  timedRpcFetch,
  withRpcFallback,
  withRpcWrite,
} from "./provider";
/**
 * Re-exported asset helpers so callers keep one RPC import path.
 */
export {
  buildErc20ApproveCall,
  getNftOwner,
  getNftOwnership,
  getNftTokenUri,
  type NftOwnerInput,
  type NftOwnership,
  type NftOwnershipInput,
  type NftStandard,
  type NftTokenUriInput,
} from "./rpc-assets";
/**
 * Re-exported exact invoke estimation so callers keep one RPC import path.
 */
export { estimateInvokeFee } from "./rpc-estimate";
/**
 * Re-exported invoke submission types and operation.
 */
export {
  type FeeSpeed,
  type InvokeInput,
  type InvokeSubmission,
  submitInvokeTransaction,
} from "./rpc-submit";
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
  /** Live authorization checked immediately before each on-chain mutation. */
  readonly isAuthorized?: () => boolean;
  readonly recipient: string;
  /** Separately reviewed ceiling for an automatic account deployment. */
  readonly reviewedDeploymentFee?: FeeEstimate;
  /** Reviewed fee ceiling; see {@link InvokeInput.reviewedFee}. */
  readonly reviewedFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: StarkHashSigner;
  readonly speed?: FeeSpeed;
  readonly token: TokenConfig;
};

/**
 * Fee estimate returned before signing; its validator and reviewed ceiling
 * policy remain single-sourced in `./fee-bounds`.
 */
export type { FeeEstimate };

/**
 * Inputs for reading transaction statuses.
 */
export type TransactionStatusInput = {
  readonly hashes: readonly string[];
  readonly rpcUrls: readonly string[];
};

/**
 * Chain-derived transaction status used by the activity feed.
 *
 * `preconfirmed` is Starknet's `PRE_CONFIRMED` finality: the block proposer has
 * executed the transaction in the block it is building, so its outcome
 * (including a revert) is already known, but consensus has not committed that
 * block. Provisional — a real outcome the user can act on, never final.
 * `ACCEPTED_ON_L1` and `ACCEPTED_ON_L2` both map to `accepted`; L1 finality is
 * tracked out of band (see {@link TransactionStatusReport}).
 */
export type TransactionStatus = "accepted" | "pending" | "preconfirmed" | "rejected" | "reverted";

/**
 * One hash's chain observation.
 *
 * - `found` is false only when the node answered that it has no record of the
 *   hash (`TXN_HASH_NOT_FOUND`); a transport failure fails over or throws
 *   instead, so this means "the node says it is gone", not "we could not ask".
 *   A pre-confirmed transaction whose block proposal never commits disappears
 *   exactly this way, but a single not-found is ordinary noise — callers must
 *   require several consecutive observations before treating it as failure.
 * - `finalizedOnL1` is true only for `ACCEPTED_ON_L1`: the reconciliation
 *   loop's terminal condition, deliberately not a {@link TransactionStatus}.
 */
export type TransactionStatusReport = {
  readonly finalizedOnL1: boolean;
  readonly found: boolean;
  readonly status: TransactionStatus;
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
export const getTokenBalances = async (
  { accountAddress, rpcUrls, tokens }: BalanceInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<readonly TokenBalance[]> => {
  if (!isNonZeroStarkFieldElement(accountAddress)) {
    throw new WalletError("Invalid account address");
  }
  return withRpcFallback(
    rpcUrls,
    async (provider) => {
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
    },
    makeProvider,
  );
};

/**
 * On-chain ERC20 metadata fetched for custom-token tracking.
 */
export type TokenMetadata = {
  readonly decimals: number;
  readonly name: string;
  readonly symbol: string;
};

/**
 * Inputs for reading ERC20 metadata by contract address.
 */
export type TokenMetadataInput = {
  readonly address: string;
  readonly rpcUrls: readonly string[];
};

// Decodes a Cairo short string (felt bytes) into ASCII, ignoring bad felts.
const decodeShortFelt = (value: string | undefined): string => {
  if (typeof value !== "string" || !isStarkFieldElement(value) || BigInt(value) === 0n) {
    return "";
  }
  try {
    return shortString.decodeShortString(value);
  } catch {
    return "";
  }
};

/**
 * Decodes an ERC20 name/symbol response into text: either a single felt short
 * string, or the Cairo ByteArray layout
 * `[words_len, ...words, pending_word, pending_len]`. Malformed felts decode to
 * empty rather than throwing.
 */
export const decodeErc20String = (response: readonly string[]): string => {
  if (response.length <= 1) {
    return decodeShortFelt(response[0]).trim();
  }
  let wordCount: number;
  try {
    wordCount = Number(BigInt(response[0] ?? "0"));
  } catch {
    return decodeShortFelt(response[0]).trim();
  }
  if (Number.isSafeInteger(wordCount) && wordCount >= 0 && response.length === wordCount + 3) {
    let text = "";
    for (let index = 1; index <= wordCount; index += 1) {
      text += decodeShortFelt(response[index]);
    }
    text += decodeShortFelt(response[wordCount + 1]);
    return text.trim();
  }
  return decodeShortFelt(response[0]).trim();
};

/**
 * Reads ERC20 name, symbol, and decimals for a contract through Starknet RPC.
 * Throws when the address is invalid or the contract exposes no usable
 * decimals; name and symbol decode both felt short strings and Cairo
 * ByteArrays.
 */
export const getTokenMetadata = async (
  { address, rpcUrls }: TokenMetadataInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<TokenMetadata> => {
  if (!isNonZeroStarkFieldElement(address)) {
    throw new WalletError("Invalid token address");
  }
  return withRpcFallback(
    rpcUrls,
    async (provider) => {
      const [nameResponse, symbolResponse, decimalsResponse] = await Promise.all([
        provider.callContract(
          { calldata: [], contractAddress: address, entrypoint: "name" },
          "latest",
        ),
        provider.callContract(
          { calldata: [], contractAddress: address, entrypoint: "symbol" },
          "latest",
        ),
        provider.callContract(
          { calldata: [], contractAddress: address, entrypoint: "decimals" },
          "latest",
        ),
      ]);
      const rawDecimals = decimalsResponse[0];
      if (typeof rawDecimals !== "string" || !isStarkFieldElement(rawDecimals)) {
        throw new WalletError("Invalid token decimals");
      }
      const decimals = Number(BigInt(rawDecimals));
      if (!isSafeDecimals(decimals)) {
        throw new WalletError("Invalid token decimals");
      }
      return {
        decimals,
        name: decodeErc20String(nameResponse),
        symbol: decodeErc20String(symbolResponse),
      };
    },
    makeProvider,
  );
};

/**
 * Signs and submits an ERC20 transfer through an account contract.
 */
export const submitErc20Transfer = async (
  {
    account,
    amount,
    isAuthorized,
    recipient,
    reviewedDeploymentFee,
    reviewedFee,
    rpcUrls,
    signHash,
    speed,
    token,
  }: TransferInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<TransferSubmission> => {
  const amountRaw = parseTokenAmount(amount, token.decimals);
  const call = buildErc20TransferCall(token.address, recipient, amountRaw);
  const result = await submitInvokeTransaction(
    {
      account,
      calls: [call],
      ...(isAuthorized === undefined ? {} : { isAuthorized }),
      ...(reviewedDeploymentFee === undefined ? {} : { reviewedDeploymentFee }),
      ...(reviewedFee === undefined ? {} : { reviewedFee }),
      rpcUrls,
      signHash,
      ...(speed === undefined ? {} : { speed }),
    },
    makeProvider,
  );
  return {
    call,
    transactionHash: result.transactionHash,
  };
};

const FINALITY_TO_STATUS: Readonly<Record<string, TransactionStatus>> = {
  ACCEPTED_ON_L1: "accepted",
  ACCEPTED_ON_L2: "accepted",
  PRE_CONFIRMED: "preconfirmed",
  REJECTED: "rejected",
};

// Unclassified, RECEIVED, and CANDIDATE answers deliberately stay pending.
const PENDING_REPORT: TransactionStatusReport = {
  finalizedOnL1: false,
  found: true,
  status: "pending",
};
const NOT_FOUND_REPORT: TransactionStatusReport = {
  finalizedOnL1: false,
  found: false,
  status: "pending",
};

/**
 * Maximum status reads in flight against one RPC endpoint.
 */
export const TRANSACTION_STATUS_CONCURRENCY = 8;

const transactionStatusEntry = async (
  provider: RpcProvider,
  transactionHash: string,
): Promise<readonly [string, TransactionStatusReport]> => {
  try {
    return [transactionHash, classifyStatus(await provider.getTransactionStatus(transactionHash))];
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return [transactionHash, isTransactionNotFoundError(error) ? NOT_FOUND_REPORT : PENDING_REPORT];
  }
};

// REVERTED execution wins over finality, including PRE_CONFIRMED.
const classifyStatus = (receipt: {
  readonly execution_status?: unknown;
  readonly finality_status?: unknown;
}): TransactionStatusReport => {
  const finality = String(receipt.finality_status ?? "");
  if (String(receipt.execution_status ?? "") === "REVERTED") {
    return { finalizedOnL1: finality === "ACCEPTED_ON_L1", found: true, status: "reverted" };
  }
  const status = FINALITY_TO_STATUS[finality];
  return status === undefined
    ? PENDING_REPORT
    : { finalizedOnL1: finality === "ACCEPTED_ON_L1", found: true, status };
};

/**
 * Reads transaction status with bounded fanout and transport failover. Explicit
 * not-found answers remain distinct so callers can tally disappearances.
 */
export const getTransactionStatuses = async (
  { hashes, rpcUrls }: TransactionStatusInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<Readonly<Record<string, TransactionStatusReport>>> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      const entries: (readonly [string, TransactionStatusReport])[] = [];
      for (let offset = 0; offset < hashes.length; offset += TRANSACTION_STATUS_CONCURRENCY) {
        const batch = hashes.slice(offset, offset + TRANSACTION_STATUS_CONCURRENCY);
        entries.push(
          ...(await Promise.all(
            batch.map((transactionHash) => transactionStatusEntry(provider, transactionHash)),
          )),
        );
      }
      return Object.fromEntries(entries);
    },
    makeProvider,
  );
