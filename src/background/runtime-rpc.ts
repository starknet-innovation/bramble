/**
 * Starknet RPC surface consumed by background message dispatch, injectable so
 * tests can stub network access.
 */

import { type ExternalAllowanceScan, scanExternalAllowances } from "../starknet/allowance-scan";
import { type VerifyClassHashInput, verifyAccountClassHash } from "../starknet/class-hash-verify";
import {
  computeMultisigTransactionId,
  getMultisigConfig,
  getMultisigProposalStatus,
  type MultisigConfigInput,
  type MultisigProposalStatusInput,
  type MultisigTransactionIdInput,
} from "../starknet/multisig";
import {
  isMultisigClassDeclared,
  type MultisigClassStatusInput,
} from "../starknet/multisig-deploy";
import {
  createHttpNftIndexer,
  type NftIndexerHttp,
  type NftIndexerService,
} from "../starknet/nft-indexer";
import {
  type NftMetadataHttp,
  type NftTokenMetadata,
  resolveNftMetadataUri,
} from "../starknet/nft-token-metadata";
import {
  type BalanceInput,
  type DeclareInput,
  type DeployAccountInput,
  type DeploymentStatusInput,
  estimateAccountDeploymentFee,
  estimateDeclareFee,
  estimateInvokeFee,
  getDeploymentStatus,
  getNftOwner,
  getNftOwnership,
  getNftTokenUri,
  type getTokenBalances,
  getTokenMetadata,
  getTransactionStatuses,
  type InvokeInput,
  type NftOwnerInput,
  type NftOwnershipInput,
  type NftTokenUriInput,
  submitAccountDeployment,
  submitDeclareTransaction,
  submitErc20Transfer,
  submitInvokeTransaction,
  type TokenMetadataInput,
  type TransactionStatusInput,
  type TransferInput,
} from "../starknet/rpc";
import { createStarkscanClient, type StarkscanHttp } from "../starknet/starkscan";
import {
  createStarkscanPreferredBalances,
  createStarkscanPreferredHistory,
} from "../starknet/starkscan-wallet";
import { createHttpStrk20Service, type Strk20Http } from "../starknet/strk20/http-service";
import type { Strk20Service } from "../starknet/strk20/service";
import type { scanTransactionHistory, TransactionHistoryScan } from "../starknet/tx-history-scan";

/**
 * Injectable multisig read operations used by the multisig message handlers.
 */
export type MultisigRpc = {
  readonly computeTransactionId: (
    input: MultisigTransactionIdInput,
  ) => ReturnType<typeof computeMultisigTransactionId>;
  readonly getConfig: (input: MultisigConfigInput) => ReturnType<typeof getMultisigConfig>;
  readonly getProposalStatus: (
    input: MultisigProposalStatusInput,
  ) => ReturnType<typeof getMultisigProposalStatus>;
  readonly isClassDeclared: (
    input: MultisigClassStatusInput,
  ) => ReturnType<typeof isMultisigClassDeclared>;
};

/**
 * Injectable Starknet RPC operations used by the message handler.
 */
export type RuntimeRpc = {
  /**
   * Estimates counterfactual account deployment without signing or broadcast.
   */
  readonly estimateAccountDeploymentFee?: (
    input: DeployAccountInput,
  ) => ReturnType<typeof estimateAccountDeploymentFee>;
  /**
   * Estimates a Cairo 1 declaration with validation skipped, so a pending dapp
   * request can show its fee without invoking protected key operations.
   */
  readonly estimateDeclareFee?: (input: DeclareInput) => ReturnType<typeof estimateDeclareFee>;
  readonly estimateInvokeFee: (input: InvokeInput) => ReturnType<typeof estimateInvokeFee>;
  /**
   * Discovers ERC20 allowances granted outside this wallet for an account's
   * tracked tokens. Optional so existing RPC stubs stay valid; when absent the
   * allowance manager lists only the locally tracked (in-wallet) approvals.
   */
  readonly getExternalAllowances?: (
    input: ExternalAllowanceScan,
  ) => ReturnType<typeof scanExternalAllowances>;
  readonly getDeploymentStatus: (
    input: DeploymentStatusInput,
  ) => ReturnType<typeof getDeploymentStatus>;
  readonly getNftOwner: (input: NftOwnerInput) => ReturnType<typeof getNftOwner>;
  /**
   * Identifies and proves ERC721/ERC1155 holdings. Optional so existing narrow
   * test doubles can retain their ERC721-only `getNftOwner` behavior.
   */
  readonly getNftOwnership?: (input: NftOwnershipInput) => ReturnType<typeof getNftOwnership>;
  /**
   * Resolves on-chain ERC721 metadata for an explicitly watched token. Optional
   * so background test doubles and deployments without metadata hydration keep
   * their existing behavior.
   */
  readonly getNftMetadata?: (input: NftTokenUriInput) => Promise<NftTokenMetadata | null>;
  readonly getTokenBalances: (input: BalanceInput) => ReturnType<typeof getTokenBalances>;
  readonly getTokenMetadata: (input: TokenMetadataInput) => ReturnType<typeof getTokenMetadata>;
  /**
   * Reads the account's recent on-chain transaction history for the activity
   * feed. Optional so existing RPC stubs stay valid; when absent the feed shows
   * only locally recorded transactions. A thrown transport error is treated by
   * the handler as "history unavailable" and degrades to the local log.
   */
  readonly getTransactionHistory?: (
    input: TransactionHistoryScan,
  ) => ReturnType<typeof scanTransactionHistory>;
  readonly getTransactionStatuses: (
    input: TransactionStatusInput,
  ) => ReturnType<typeof getTransactionStatuses>;
  readonly submitAccountDeployment: (
    input: DeployAccountInput,
  ) => ReturnType<typeof submitAccountDeployment>;
  readonly submitDeclareTransaction: (
    input: DeclareInput,
  ) => ReturnType<typeof submitDeclareTransaction>;
  readonly submitErc20Transfer: (input: TransferInput) => ReturnType<typeof submitErc20Transfer>;
  readonly submitInvokeTransaction: (
    input: InvokeInput,
  ) => ReturnType<typeof submitInvokeTransaction>;
  /**
   * On-chain class-hash verification. Optional so existing RPC stubs stay
   * valid; when absent the account screen reports verification as unavailable
   * (fail closed — never a silent "verified").
   */
  readonly verifyAccountClassHash?: (
    input: VerifyClassHashInput,
  ) => ReturnType<typeof verifyAccountClassHash>;
  /**
   * Multisig read surface. Optional so existing RPC stubs stay valid; when
   * absent the multisig handlers report the feature as unavailable.
   */
  readonly multisig?: MultisigRpc;
  /**
   * NFT auto-discovery indexer. Optional so existing RPC stubs stay valid; when
   * absent the discovery handler falls back to an empty owned-NFT list.
   */
  readonly nftIndexer?: NftIndexerService;
  /**
   * STRK20 privacy service. Optional so existing RPC stubs stay valid; when
   * absent the handler falls back to {@link unavailableStrk20Service}, which
   * reports the account as not registered.
   */
  readonly strk20?: Strk20Service;
};

// Real network transport for the STRK20 prover: a thin `fetch` wrapper matching
// the {@link Strk20Http} shape the HTTP service expects.
const strk20Http: Strk20Http = (url, init) => fetch(url, init);

// Real network transport for the NFT indexer: a thin `fetch` wrapper matching
// the {@link NftIndexerHttp} shape the discovery client expects.
const nftIndexerHttp: NftIndexerHttp = (url) => fetch(url);
const NFT_METADATA_TIMEOUT_MS = 10_000;
const nftMetadataHttp: NftMetadataHttp = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(NFT_METADATA_TIMEOUT_MS) });
const starkscanHttp: StarkscanHttp = (url, init) => fetch(url, init);
// The public explorer read lane is used because an extension cannot safely
// embed an external API key. The client keeps its base injectable so a
// deployment-owned authenticated relay can replace this without changing
// wallet consumers.
const starkscanClient = createStarkscanClient({
  baseUrl: "https://starkscan.co/v1",
  http: starkscanHttp,
});
const getPreferredBalances = createStarkscanPreferredBalances(starkscanClient);
const getPreferredHistory = createStarkscanPreferredHistory(starkscanClient);

const getNftMetadata = async (input: NftTokenUriInput): Promise<NftTokenMetadata | null> =>
  resolveNftMetadataUri(await getNftTokenUri(input), nftMetadataHttp);

/**
 * Production RPC wiring used when no stub is injected.
 */
export const defaultRuntimeRpc: RuntimeRpc = {
  estimateAccountDeploymentFee,
  estimateDeclareFee,
  estimateInvokeFee,
  getExternalAllowances: scanExternalAllowances,
  getDeploymentStatus,
  getNftMetadata,
  getNftOwner,
  getNftOwnership,
  getTokenBalances: getPreferredBalances,
  getTokenMetadata,
  getTransactionHistory: getPreferredHistory,
  getTransactionStatuses,
  multisig: {
    computeTransactionId: computeMultisigTransactionId,
    getConfig: getMultisigConfig,
    getProposalStatus: getMultisigProposalStatus,
    isClassDeclared: isMultisigClassDeclared,
  },
  nftIndexer: createHttpNftIndexer(nftIndexerHttp),
  submitAccountDeployment,
  submitDeclareTransaction,
  submitErc20Transfer,
  submitInvokeTransaction,
  strk20: createHttpStrk20Service(strk20Http),
  verifyAccountClassHash,
};
