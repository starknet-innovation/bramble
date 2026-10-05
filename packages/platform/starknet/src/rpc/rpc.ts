/**
 * Starknet RPC wallet operations backed by starknet-js and Krusty signatures.
 */
import { WalletError } from "@bramble/core/errors";
import { isSafeDecimals } from "@bramble/core/json";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { isNonZeroStarkFieldElement, isStarkFieldElement } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { type Call, CallData, cairo, type RpcProvider, shortString } from "starknet";
import { parseTokenAmount } from "./balances";
import type { FeeEstimate } from "./fee-bounds";
import { type StarkHashSigner, withRpcFallback } from "./provider";
import { type FeeSpeed, type InvokeInput, submitInvokeTransaction } from "./rpc-submit";

export {
  argentSigningRestriction,
  braavosSigningRestriction,
  getArgentSigningRestriction,
  getBraavosSigningRestriction,
  type SigningRestrictionInput,
} from "../transactions/account-compatibility";
/**
 * Re-exported advisory signability probe for recovery candidates (issue 542).
 */
/**
 * Re-exported phrase-driven Ready (Argent) guardian removal.
 */
export {
  type ArgentRecoveryInput,
  type ArgentRecoveryState,
  DEFAULT_ARGENT_ESCAPE_SECURITY_PERIOD_SECONDS,
  getArgentRecoveryState,
  reviewArgentRecovery,
  submitArgentRecovery,
} from "../transactions/argent-recovery";
/**
 * Re-exported seed-driven Braavos recovery (deferred 2FA removal).
 */
export {
  type BraavosRecoveryInput,
  type BraavosRecoveryState,
  DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS,
  getBraavosRecoveryState,
  reviewBraavosRecovery,
  submitBraavosRecovery,
} from "../transactions/braavos-recovery";
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
 * Re-exported amount helpers and balance reads so callers keep one RPC import path.
 */
export {
  type BalanceInput,
  formatTokenAmount,
  getTokenBalances,
  parseTokenAmount,
} from "./balances";
/**
 * Re-exported provider helpers so existing callers keep one import path.
 */
export {
  IndeterminateRpcWriteError,
  isBlockNotFoundError,
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
export { isTokenBalance, type TokenBalance } from "./token-balance";
/**
 * Re-exported transaction-status reads so callers keep one RPC import path.
 */
export {
  classifyTransactionStatus,
  getTransactionStatuses,
  TRANSACTION_STATUS_CONCURRENCY,
  type TransactionStatus,
  type TransactionStatusInput,
  type TransactionStatusReport,
} from "./transaction-status";
/**
 * ERC20 transfer submission result.
 */
export type TransferSubmission = {
  readonly call: Call;
  readonly transactionHash: string;
};

/**
 * Inputs for submitting one ERC20 transfer.
 */
export type TransferInput = {
  readonly account: AccountRef;
  readonly amount: string;
  /** Live authorization checked immediately before each on-chain mutation. */
  readonly isAuthorized?: () => boolean;
  /**
   * Journal hook; see {@link InvokeInput.onSigned}. The caller learns the
   * signed transfer's hash before it is sent, so a send whose answer is lost
   * can still be tracked instead of being reported as not sent.
   */
  readonly onSigned?: InvokeInput["onSigned"];
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
    onSigned,
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
      ...(onSigned === undefined ? {} : { onSigned }),
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
