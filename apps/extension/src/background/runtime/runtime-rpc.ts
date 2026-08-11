/**
 * Starknet RPC surface consumed by background message dispatch, injectable so
 * tests can stub network access.
 */

import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { type ExplorerLanePreferences } from "@mc-wallet/wallet-model/preferences";
import { type ExternalAllowanceScan, scanExternalAllowances, type TrackedAllowanceScan, readTrackedAllowances } from "@mc-wallet/transactions/allowance-scan";
import { type VerifyClassHashInput, verifyAccountClassHash } from "@mc-wallet/starknet/class-hash-verify";

import {
  computeMultisigTransactionId,
  getMultisigConfig,
  getMultisigProposalStatus,
  type MultisigConfigInput,
  type MultisigProposalStatusInput,
  type MultisigTransactionIdInput,
} from "@mc-wallet/multisig/chain";
import {
  isMultisigClassDeclared,
  type MultisigClassStatusInput,
} from "@mc-wallet/multisig/deploy";
import {
  discoverMultisigProposalIds,
  type MultisigProposalDiscoveryInput,
} from "@mc-wallet/multisig/discovery";
import {
  createHttpNftIndexer,
  type NftIndexerHttp,
  type NftIndexerService,
} from "@mc-wallet/portfolio/nft-indexer";
import {
  type NftMetadataHttp,
  type NftTokenMetadata,
  resolveNftMetadataUri,
} from "@mc-wallet/portfolio/nft-token-metadata";
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
} from "@mc-wallet/starknet/rpc";
import { createStarkscanClient, type StarkscanHttp } from "@mc-wallet/transactions/starkscan";
import {
  createRpcFirstBalances,
  createRpcFirstHistory,
} from "@mc-wallet/transactions/starkscan-wallet";
import type { Strk20Service } from "@mc-wallet/privacy/service";
import type { scanTransactionHistory, TransactionHistoryScan } from "@mc-wallet/transactions/tx-history-scan";
import { untrustedFetch } from "@mc-wallet/core/http-json";


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
  /**
   * Discovers proposal ids submitted by other signers. Optional for narrow
   * test doubles; production always wires the bounded event scan.
   */
  readonly discoverProposalIds?: (
    input: MultisigProposalDiscoveryInput,
  ) => ReturnType<typeof discoverMultisigProposalIds>;
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
  /**
   * Reads the live on-chain amount of allowances the wallet already tracks, one
   * direct `allowance(owner, spender)` call per record — no event scan, so it
   * reaches tokens the user does not track and multisig scopes the account only
   * signs for. Optional so existing RPC stubs stay valid; when absent the
   * manager reports what the local log holds, including any record it can only
   * state as a lower bound.
   */
  readonly getTrackedAllowances?: (
    input: TrackedAllowanceScan,
  ) => ReturnType<typeof readTrackedAllowances>;
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

// Real network transports for the untrusted read boundaries. All of them are
// the SHARED `untrustedFetch` rather than a local lambda: a wrapper written here
// would type-check while dropping the deadline and the redirect refusal the
// bounded reader composed (MCW-V09-122), which is how three of these boundaries
// once shipped unhardened.
const nftIndexerHttp: NftIndexerHttp = untrustedFetch;
const NFT_METADATA_TIMEOUT_MS = 10_000;
const nftMetadataHttp: NftMetadataHttp = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(NFT_METADATA_TIMEOUT_MS) });
const starkscanHttp: StarkscanHttp = untrustedFetch;
// The public explorer read lane is used because an extension cannot safely
// embed an external API key. The client keeps its base injectable so a
// deployment-owned authenticated relay can replace this without changing
// wallet consumers.
const starkscanClient = createStarkscanClient({
  baseUrl: "https://starkscan.co/v1",
  http: starkscanHttp,
});
const getNftMetadata = async (input: NftTokenUriInput): Promise<NftTokenMetadata | null> =>
  resolveNftMetadataUri(await getNftTokenUri(input), nftMetadataHttp);

/**
 * Collaborators the production RPC wiring needs beyond the network itself.
 *
 * `readPreferences` is only consulted to decide whether the third-party
 * explorer read lane may run after every configured RPC has failed
 * (MCW-V09-129). A rejected read is treated as "not permitted", so a
 * preferences outage narrows disclosure rather than widening it.
 */
export type RuntimeRpcOptions = {
  readonly readPreferences: () => Promise<ExplorerLanePreferences>;
};

/**
 * Builds the production RPC wiring bound to one preferences reader.
 */
export const createDefaultRuntimeRpc = ({ readPreferences }: RuntimeRpcOptions): RuntimeRpc => ({
  estimateAccountDeploymentFee,
  estimateDeclareFee,
  estimateInvokeFee,
  getExternalAllowances: scanExternalAllowances,
  getTrackedAllowances: readTrackedAllowances,
  getDeploymentStatus,
  getNftMetadata,
  getNftOwner,
  getNftOwnership,
  getTokenBalances: createRpcFirstBalances({ client: starkscanClient, readPreferences }),
  getTokenMetadata,
  getTransactionHistory: createRpcFirstHistory({ client: starkscanClient, readPreferences }),
  getTransactionStatuses,
  multisig: {
    computeTransactionId: computeMultisigTransactionId,
    discoverProposalIds: discoverMultisigProposalIds,
    getConfig: getMultisigConfig,
    getProposalStatus: getMultisigProposalStatus,
    isClassDeclared: isMultisigClassDeclared,
  },
  nftIndexer: createHttpNftIndexer(nftIndexerHttp),
  submitAccountDeployment,
  submitDeclareTransaction,
  submitErc20Transfer,
  submitInvokeTransaction,
  verifyAccountClassHash,
});

/**
 * RPC wiring for callers with no preferences store of their own — the message
 * router's fallback and isolated tests. It answers from default preferences, so
 * the explorer lane behaves as it does for a user on the built-in RPCs. The
 * worker builds its own instance from the real store
 * ({@link createDefaultRuntimeRpc}); this constant must not be substituted for
 * it, or a configured RPC override would stop suppressing the lane.
 */
export const defaultRuntimeRpc: RuntimeRpc = createDefaultRuntimeRpc({
  readPreferences: async () => defaultWalletPreferences(),
});
