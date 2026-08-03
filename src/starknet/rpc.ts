/**
 * Starknet RPC wallet operations backed by starknet-js and Krusty signatures.
 */
import { type Call, CallData, cairo, type RpcProvider, shortString } from "starknet";
import { WalletError } from "../shared/errors";
import type { TokenConfig } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "./networks";
import {
  isTransactionNotFoundError,
  isTransportRpcError,
  krustyAccount,
  type StarkHashSigner,
  withRpcFallback,
} from "./provider";
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
} from "./declare";
/**
 * Re-exported counterfactual deployment operations.
 */
export {
  type AccountDeployment,
  type AccountDeploymentFeeEstimate,
  type DeployAccountInput,
  type DeploymentStatusInput,
  type DeploySubmission,
  estimateAccountDeploymentFee,
  getDeploymentStatus,
  ozAccountDeployment,
  submitAccountDeployment,
} from "./deployment";
/**
 * Re-exported provider helpers so existing callers keep one import path.
 */
export {
  isContractNotFoundError,
  isTransactionNotFoundError,
  isTransportRpcError,
  type StarkHashSigner,
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
 * Re-exported invoke submission types and operation.
 */
export {
  type FeeSpeed,
  type InvokeInput,
  type InvokeSubmission,
  submitInvokeTransaction,
} from "./rpc-submit";

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
      if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) {
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
  { account, amount, recipient, rpcUrls, signHash, speed, token }: TransferInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<TransferSubmission> => {
  const amountRaw = parseTokenAmount(amount, token.decimals);
  const call = buildErc20TransferCall(token.address, recipient, amountRaw);
  const result = await submitInvokeTransaction(
    {
      account,
      calls: [call],
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

/**
 * Estimates the fee for invoke calls without broadcasting anything.
 */
export const estimateInvokeFee = async (
  { account, calls, rpcUrls, signHash }: InvokeInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<FeeEstimate> => {
  if (calls.length === 0) {
    throw new WalletError("No calls to estimate");
  }
  return withRpcFallback(
    rpcUrls,
    async (provider) => {
      const starknetAccount = krustyAccount(provider, account, signHash);
      const estimate = await starknetAccount.estimateInvokeFee([...calls]);
      return {
        overallFee: BigInt(estimate.overall_fee).toString(),
        unit: typeof estimate.unit === "string" ? estimate.unit : "FRI",
      };
    },
    makeProvider,
  );
};

const FINALITY_TO_STATUS: Readonly<Record<string, TransactionStatus>> = {
  ACCEPTED_ON_L1: "accepted",
  ACCEPTED_ON_L2: "accepted",
  PRE_CONFIRMED: "preconfirmed",
  REJECTED: "rejected",
};

// A hash the node answered about but could not classify, and the shape used for
// RECEIVED / CANDIDATE, which deliberately still read as pending.
const PENDING_REPORT: TransactionStatusReport = {
  finalizedOnL1: false,
  found: true,
  status: "pending",
};
// A hash the node explicitly has no record of.
const NOT_FOUND_REPORT: TransactionStatusReport = {
  finalizedOnL1: false,
  found: false,
  status: "pending",
};

/**
 * Maximum transaction-status reads in flight against one RPC endpoint. This
 * bounds background reconciliation fanout across wallets with many accounts;
 * batches remain sequential so a transport failure can fail over cleanly.
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

// Maps a status response to a wallet report. REVERTED execution wins over
// finality — a reverted transaction can be ACCEPTED_ON_L2, and it is already
// reverted while PRE_CONFIRMED — so a pre-confirmed revert reads as reverted,
// never as a provisional success. Unmapped finality (RECEIVED, CANDIDATE) stays
// pending.
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
 * Reads finality/execution status for submitted transactions.
 *
 * Transport failures fail over to the next endpoint (or throw when none is
 * left) so a node outage is never mistaken for a chain answer. A node that
 * answers `TXN_HASH_NOT_FOUND` yields a `found: false` report so callers can
 * tally consecutive disappearances; any other semantic error reads as pending.
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
