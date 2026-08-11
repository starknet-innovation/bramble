/**
 * Domain types shared by Starkscan clients and indexed wallet adapters.
 */
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";

/**
 * Starkscan-backed networks. Local devnet deliberately remains RPC-only.
 */
export type StarkscanChainId = Exclude<StarknetNetworkId, "SN_DEVNET">;

/**
 * Opaque-cursor page returned by Starkscan list endpoints.
 */
export type StarkscanPage<T> = {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
};

/**
 * Indexed summary for a Starknet address.
 */
export type StarkscanAddressSummary = {
  readonly address: string;
  readonly totalActivityCount: number;
  readonly latestActivityBlock: number | null;
  readonly activityCountExact: boolean;
  readonly classHash: string | null;
  readonly isAccount: boolean | null;
  readonly createdOnIso: string | null;
  readonly deployedAtTxHash: string | null;
  readonly deployedByAddress: string | null;
};

/**
 * Transaction-level activity attributed to an address.
 */
export type StarkscanAddressTransaction = {
  readonly blockNumber: number;
  readonly timestampIso: string;
  readonly txIndex: number;
  readonly txHash: string;
  readonly kinds: readonly string[];
  readonly counterparty: string | null;
  readonly txType: string | null;
  readonly executionStatus: string | null;
  readonly finalityStatus: string | null;
  readonly transferCount: number;
  readonly operationKind: string | null;
  readonly operationLabel: string | null;
};

/**
 * Address activity leg returned by the normalized activity feed.
 */
export type StarkscanAddressActivity = {
  readonly blockNumber: number;
  readonly timestampIso: string;
  readonly txIndex: number;
  readonly logIndex: number | null;
  readonly transferIndex: number | null;
  readonly txHash: string;
  readonly kind: string;
  readonly counterparty: string | null;
  readonly tokenAddress: string | null;
  readonly amount: string | null;
  readonly tokenId: string | null;
};

/**
 * Normalized ERC20/ERC721/ERC1155 transfer from Starkscan.
 */
export type StarkscanTransfer = {
  readonly blockNumber: number;
  readonly timestampIso: string;
  readonly txIndex: number;
  readonly logIndex: number;
  readonly transferIndex: number;
  readonly txHash: string;
  readonly tokenAddress: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly amount: string | null;
  readonly rawValue: string;
  readonly tokenId: string | null;
  readonly standard: "erc20" | "erc721" | "erc1155";
  readonly tokenSymbol: string | null;
  readonly tokenName: string | null;
  readonly tokenDecimals: number | null;
  readonly sourceTier: "finalized" | "head";
  readonly actionContext: string | null;
};

/**
 * One fungible-token balance in an indexed holdings snapshot.
 */
export type StarkscanTokenHolding = {
  readonly tokenAddress: string;
  readonly normalizedTokenAddress: string;
  readonly indexedBalanceRaw: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
};

/**
 * Completeness proof attached to an indexed holdings snapshot.
 */
export type StarkscanHoldingsCompleteness = {
  readonly exact: boolean;
  readonly truncated: boolean;
  readonly complete: boolean;
  readonly reasonCode: string;
  readonly reason: string;
  readonly lagBlocks: number | null;
  readonly capped: boolean;
  readonly cap: number | null;
};

/**
 * Indexed fungible-token holdings for one address.
 */
export type StarkscanTokenHoldings = {
  readonly chainId: StarkscanChainId;
  readonly ownerAddress: string;
  readonly items: readonly StarkscanTokenHolding[];
  readonly exact: boolean;
  readonly truncated: boolean;
  readonly completeness: StarkscanHoldingsCompleteness;
};

/**
 * Current or block-pinned balance for one token and owner.
 */
export type StarkscanTokenBalance = {
  readonly chainId: StarkscanChainId;
  readonly tokenAddress: string;
  readonly ownerAddress: string;
  readonly blockTag: string;
  readonly balanceRaw: string;
};

/**
 * Indexed contract deployment and classification metadata.
 */
export type StarkscanContractMetadata = {
  readonly chainId: StarkscanChainId;
  readonly address: string;
  readonly classHash: string | null;
  readonly deployedAtBlock: number | null;
  readonly deployedAtTx: string | null;
  readonly createdOnIso: string | null;
  readonly deployedByAddress: string | null;
  readonly isAccount: boolean | null;
  readonly isToken: boolean | null;
  readonly tokenKind: string | null;
  readonly alias: string | null;
  readonly metadataCompleteness: boolean;
  readonly source: string;
};

/**
 * Raw event with optional ABI-derived naming from Starkscan.
 */
export type StarkscanContractEvent = {
  readonly blockNumber: number;
  readonly timestampIso: string;
  readonly txHash: string;
  readonly txIndex: number;
  readonly logIndex: number;
  readonly address: string;
  readonly keys: readonly string[];
  readonly data: readonly string[];
  readonly decodingStatus: string;
  readonly eventName: string | null;
  readonly sourceTier: "finalized" | "head" | null;
};

/**
 * Recent Starknet block summary used by live chain surfaces.
 */
export type StarkscanBlock = {
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly parentHash: string;
  readonly timestampIso: string;
  readonly txCount: number;
  readonly finalityStatus: string;
};

/**
 * Options shared by opaque-cursor list endpoints.
 */
export type StarkscanPageOptions = {
  readonly cursor?: string;
  readonly limit?: number;
};
