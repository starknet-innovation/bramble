/**
 * Starknet RPC surface consumed by background message dispatch, injectable so
 * tests can stub network access.
 */

import { untrustedFetch } from "@bramble/core/http-json";
import {
  type ArgentMultisigConfigInput,
  type ArgentSignerDiscoveryInput,
  getArgentMultisigConfig,
  getArgentMultisigSignerPublicKeys,
} from "@bramble/multisig/chain";
import {
  type ArgentMultisigClassStatusInput,
  isArgentMultisigClassDeclared,
} from "@bramble/multisig/deploy";
import {
  getMultisigSignerAccount,
  type MultisigSignerAccountInput,
} from "@bramble/multisig/signer-account";
import {
  createHttpNftIndexer,
  type NftIndexerHttp,
  type NftIndexerService,
} from "@bramble/portfolio/nft-indexer";
import {
  type NftMetadataHttp,
  type NftTokenMetadata,
  resolveNftMetadataUri,
} from "@bramble/portfolio/nft-token-metadata";
import type { Strk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import {
  type VerifyClassHashInput,
  verifyAccountClassHash,
} from "@bramble/starknet/class-hash-verify";
import {
  type PrepareArgentMultisigInvokeV3Input,
  prepareArgentMultisigInvokeV3,
  type SubmitPreparedArgentMultisigInvokeV3Input,
  submitPreparedArgentMultisigInvokeV3,
} from "@bramble/starknet/multisig-invoke";
import { withRpcFallback } from "@bramble/starknet/provider";
import {
  type ArgentRecoveryInput,
  type BalanceInput,
  type BraavosRecoveryInput,
  type DeclareInput,
  type DeployAccountInput,
  type DeploymentStatusInput,
  estimateAccountDeploymentFee,
  estimateDeclareFee,
  estimateInvokeFee,
  getArgentRecoveryState,
  getArgentSigningRestriction,
  getBraavosRecoveryState,
  getBraavosSigningRestriction,
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
  reviewArgentRecovery,
  reviewBraavosRecovery,
  type SigningRestrictionInput,
  submitAccountDeployment,
  submitArgentRecovery,
  submitBraavosRecovery,
  submitDeclareTransaction,
  submitErc20Transfer,
  submitInvokeTransaction,
  type TokenMetadataInput,
  type TransactionStatusInput,
  type TransferInput,
} from "@bramble/starknet/rpc";
import {
  type ExternalAllowanceScan,
  readTrackedAllowances,
  scanExternalAllowances,
  type TrackedAllowanceScan,
} from "@bramble/transactions/allowance-scan";
import { createStarkscanClient, type StarkscanHttp } from "@bramble/transactions/starkscan";
import {
  createExplorerFirstHistory,
  createRpcFirstBalances,
  type DiscoveredHistory,
} from "@bramble/transactions/starkscan-wallet";
import type { TransactionHistoryScan } from "@bramble/transactions/tx-history-scan";
import { canonicalFelt, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { ExplorerLanePreferences } from "@bramble/wallet-model/preferences";

/**
 * Injectable multisig read operations used by the multisig message handlers.
 */
type MultisigRpc = {
  readonly getConfig: (
    input: ArgentMultisigConfigInput,
  ) => ReturnType<typeof getArgentMultisigConfig>;
  readonly getSignerPublicKeys?: (
    input: ArgentSignerDiscoveryInput,
  ) => ReturnType<typeof getArgentMultisigSignerPublicKeys>;
  readonly getNonce: (input: {
    readonly address: string;
    readonly rpcUrls: readonly string[];
  }) => Promise<string>;
  readonly isClassDeclared: (
    input: ArgentMultisigClassStatusInput,
  ) => ReturnType<typeof isArgentMultisigClassDeclared>;
  readonly prepareInvoke: (
    input: PrepareArgentMultisigInvokeV3Input,
  ) => ReturnType<typeof prepareArgentMultisigInvokeV3>;
  readonly resolveSignerAccount?: (
    input: MultisigSignerAccountInput,
  ) => ReturnType<typeof getMultisigSignerAccount>;
  readonly submitPreparedInvoke: (
    input: SubmitPreparedArgentMultisigInvokeV3Input,
  ) => ReturnType<typeof submitPreparedArgentMultisigInvokeV3>;
};

const getArgentMultisigNonce = async (input: {
  readonly address: string;
  readonly rpcUrls: readonly string[];
}): Promise<string> =>
  withRpcFallback(input.rpcUrls, async (provider) => {
    const nonce = canonicalFelt(await provider.getNonceForAddress(input.address, "latest"));
    if (nonce === null) {
      throw new Error("Invalid Argent multisig nonce response");
    }
    return nonce;
  });

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
  /**
   * Advisory signability probe for deployed Argent recovery candidates (issue
   * 542). Optional so narrow test doubles keep compiling; the scan treats an
   * absent member or a throw as "no verdict".
   */
  readonly getArgentSigningRestriction?: (
    input: SigningRestrictionInput,
  ) => ReturnType<typeof getArgentSigningRestriction>;
  /** Braavos sibling of the Argent probe; same advisory contract. */
  readonly getBraavosSigningRestriction?: (
    input: SigningRestrictionInput,
  ) => ReturnType<typeof getBraavosSigningRestriction>;
  /** Pending-state read for the Ready recovery flow; advisory, read-only. */
  readonly getArgentRecoveryState?: (
    input: Parameters<typeof getArgentRecoveryState>[0],
  ) => ReturnType<typeof getArgentRecoveryState>;
  /** Estimates the Ready recovery's next escape step. */
  readonly reviewArgentRecovery?: (
    input: ArgentRecoveryInput,
  ) => ReturnType<typeof reviewArgentRecovery>;
  /** Submits the reviewed Ready recovery step. */
  readonly submitArgentRecovery?: (
    input: ArgentRecoveryInput,
  ) => ReturnType<typeof submitArgentRecovery>;
  /** Pending-state read for the Braavos recovery flow; advisory, read-only. */
  readonly getBraavosRecoveryState?: (
    input: Parameters<typeof getBraavosRecoveryState>[0],
  ) => ReturnType<typeof getBraavosRecoveryState>;
  /** Estimates the Braavos recovery request for its review card. */
  readonly reviewBraavosRecovery?: (
    input: BraavosRecoveryInput,
  ) => ReturnType<typeof reviewBraavosRecovery>;
  /** Submits the reviewed Braavos recovery request. */
  readonly submitBraavosRecovery?: (
    input: BraavosRecoveryInput,
  ) => ReturnType<typeof submitBraavosRecovery>;
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
   * feed — explorer first when the user's preference permits, RPC scan
   * otherwise. Optional so existing RPC stubs stay valid; when absent the feed
   * shows only locally recorded transactions. A thrown error means neither lane
   * answered and is treated by the handler as "history unavailable", degrading
   * to the local log.
   */
  readonly getTransactionHistory?: (input: TransactionHistoryScan) => Promise<DiscoveredHistory>;
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
// embed an external API key; the bundled base answers without one and lives on
// a host the manifest already permits. The client keeps its base injectable so
// a deployment-owned authenticated relay can replace this without changing
// wallet consumers. Balances stay RPC-first with the explorer as the outage
// rescue; transaction history is explorer-first (the RPC scan reaches back
// only a few days of blocks) with the RPC scan as the keyless fallback. Both
// obey the user's per-network `explorerFallback` choice.
const DEFAULT_EXPLORER_API_URL = "https://starkscan.co/v1";
const starkscanClients = new Map<string, ReturnType<typeof createStarkscanClient>>();
const starkscanClientFor = (baseUrl: string): ReturnType<typeof createStarkscanClient> => {
  const stored = starkscanClients.get(baseUrl);
  if (stored) return stored;
  const client = createStarkscanClient({ baseUrl, http: starkscanHttp });
  starkscanClients.set(baseUrl, client);
  return client;
};
const starkscanClient = starkscanClientFor(DEFAULT_EXPLORER_API_URL);
const configuredStarkscanClient = (
  networkId: StarknetNetworkId,
  preferences: ExplorerLanePreferences,
): ReturnType<typeof createStarkscanClient> =>
  starkscanClientFor(preferences.explorerApiUrls?.[networkId] ?? DEFAULT_EXPLORER_API_URL);
const getNftMetadata = async (input: NftTokenUriInput): Promise<NftTokenMetadata | null> =>
  resolveNftMetadataUri(await getNftTokenUri(input), nftMetadataHttp);

/**
 * Collaborators the production RPC wiring needs beyond the network itself.
 *
 * `readPreferences` is only consulted to decide whether the third-party
 * explorer read lane may run for a network (MCW-V09-129): as the outage rescue
 * for balances, and as the primary source for transaction history. A rejected
 * read is treated as "not permitted", so a preferences outage narrows
 * disclosure rather than widening it.
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
  getArgentSigningRestriction,
  getArgentRecoveryState,
  getBraavosRecoveryState,
  getBraavosSigningRestriction,
  getDeploymentStatus,
  reviewArgentRecovery,
  reviewBraavosRecovery,
  submitArgentRecovery,
  submitBraavosRecovery,
  getNftMetadata,
  getNftOwner,
  getNftOwnership,
  getTokenBalances: createRpcFirstBalances({
    client: starkscanClient,
    clientFor: configuredStarkscanClient,
    readPreferences,
  }),
  getTokenMetadata,
  getTransactionHistory: createExplorerFirstHistory({
    client: starkscanClient,
    clientFor: configuredStarkscanClient,
    readPreferences,
  }),
  getTransactionStatuses,
  multisig: {
    getConfig: getArgentMultisigConfig,
    getSignerPublicKeys: getArgentMultisigSignerPublicKeys,
    getNonce: getArgentMultisigNonce,
    isClassDeclared: isArgentMultisigClassDeclared,
    prepareInvoke: prepareArgentMultisigInvokeV3,
    resolveSignerAccount: getMultisigSignerAccount,
    submitPreparedInvoke: submitPreparedArgentMultisigInvokeV3,
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
