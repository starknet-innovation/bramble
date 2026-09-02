/**
 * Starknet RPC surface consumed by background message dispatch, injectable so
 * tests can stub network access.
 */

import { untrustedFetch } from "@mc-wallet/core/http-json";
import {
  type ArgentMultisigConfigInput,
  type ArgentSignerDiscoveryInput,
  getArgentMultisigConfig,
  getArgentMultisigSignerPublicKeys,
} from "@mc-wallet/multisig/chain";
import {
  type ArgentMultisigClassStatusInput,
  isArgentMultisigClassDeclared,
} from "@mc-wallet/multisig/deploy";
import {
  getMultisigSignerAccount,
  type MultisigSignerAccountInput,
} from "@mc-wallet/multisig/signer-account";
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
import type { Strk20Service } from "@mc-wallet/privacy/service";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import {
  type VerifyClassHashInput,
  verifyAccountClassHash,
} from "@mc-wallet/starknet/class-hash-verify";
import {
  type PrepareArgentMultisigInvokeV3Input,
  prepareArgentMultisigInvokeV3,
  type SubmitPreparedArgentMultisigInvokeV3Input,
  submitPreparedArgentMultisigInvokeV3,
} from "@mc-wallet/starknet/multisig-invoke";
import type { MlDsaCalldata } from "@mc-wallet/starknet/provider";
import { withRpcFallback } from "@mc-wallet/starknet/provider";
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
import {
  type ExternalAllowanceScan,
  readTrackedAllowances,
  scanExternalAllowances,
  type TrackedAllowanceScan,
} from "@mc-wallet/transactions/allowance-scan";
import { createStarkscanClient, type StarkscanHttp } from "@mc-wallet/transactions/starkscan";
import {
  createRpcFirstBalances,
  createRpcFirstHistory,
} from "@mc-wallet/transactions/starkscan-wallet";
import type {
  scanTransactionHistory,
  TransactionHistoryScan,
} from "@mc-wallet/transactions/tx-history-scan";
import { canonicalFelt, type StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { ExplorerLanePreferences } from "@mc-wallet/wallet-model/preferences";

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
 * explorer read lane may run after every configured RPC has failed
 * (MCW-V09-129). A rejected read is treated as "not permitted", so a
 * preferences outage narrows disclosure rather than widening it.
 */
export type RuntimeRpcOptions = {
  readonly readPreferences: () => Promise<ExplorerLanePreferences>;
  /**
   * ML-DSA calldata builders from Krusty KMS, attached to every input that can
   * carry a paired-phone account. Injected in one place on purpose: a call site
   * that forgot them would not fail to compile — the field is optional on those
   * inputs — it would abort at the signer, after the user had already consented.
   */
  readonly mlDsa?: MlDsaCalldata;
};

/**
 * Builds the production RPC wiring bound to one preferences reader.
 */
export const createDefaultRuntimeRpc = ({
  mlDsa,
  readPreferences,
}: RuntimeRpcOptions): RuntimeRpc => ({
  estimateAccountDeploymentFee: (input) =>
    estimateAccountDeploymentFee(mlDsa ? { ...input, mlDsa } : input),
  estimateDeclareFee,
  estimateInvokeFee: (input) => estimateInvokeFee(mlDsa ? { ...input, mlDsa } : input),
  getExternalAllowances: scanExternalAllowances,
  getTrackedAllowances: readTrackedAllowances,
  getDeploymentStatus,
  getNftMetadata,
  getNftOwner,
  getNftOwnership,
  getTokenBalances: createRpcFirstBalances({
    client: starkscanClient,
    clientFor: configuredStarkscanClient,
    readPreferences,
  }),
  getTokenMetadata,
  getTransactionHistory: createRpcFirstHistory({
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
  submitAccountDeployment: (input) => submitAccountDeployment(mlDsa ? { ...input, mlDsa } : input),
  submitDeclareTransaction,
  submitErc20Transfer: (input) => submitErc20Transfer(mlDsa ? { ...input, mlDsa } : input),
  submitInvokeTransaction: (input) => submitInvokeTransaction(mlDsa ? { ...input, mlDsa } : input),
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
