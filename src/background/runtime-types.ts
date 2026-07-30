/**
 * Shared background runtime response and service types.
 */
import type { StarkSignature } from "../crypto/krusty";
import type { AllowanceView } from "../starknet/allowance-discovery";
import type { SwapCatalogToken } from "../starknet/avnu";
import type { ClassHashVerification } from "../starknet/class-hash-verify";
import type { StarknetNetworkId } from "../starknet/networks";
import type { DiscoveredNft } from "../starknet/nft-metadata";
import type { FeeEstimate, TokenBalance } from "../starknet/rpc";
import type { RiskFlag } from "../starknet/verify";
import type { ActivityEntry } from "../storage/activity-store";
import type { MultisigProposalRecord, MultisigRecord } from "../storage/multisig-store";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef, LedgerAccountRef, Vault } from "../storage/vault-schema";
import type { AccountDerivationInput } from "../wallet/accounts";
import type {
  AddDerivedAccountInput,
  AddLedgerAccountInput,
  ConnectedSite,
  CreateLedgerVaultInput,
  CreateVaultAccountInput,
  DeriveLedgerAccountsInput,
  EnsureNetworkAccountInput,
  ImportRawKeyAccountInput,
  OriginGrantInput,
  RevokeOriginInput,
  SetActiveAccountInput,
  SignHashInput,
  WalletStatus as VaultStatus,
} from "../wallet/vault-service";
import type { PendingApproval } from "./approvals";
import type { PendingLedgerSign } from "./ledger-sign-queue";
import type {
  Strk20BalancesResponse,
  Strk20PrepareResponse,
  Strk20SubaccountCommitmentResponse,
  Strk20WalletPreparationResponse,
  Strk20WalletStateResponse,
} from "./runtime-strk20-types";
import type { SwapPreparationReview } from "./swap-preparations";

/**
 * Network selector option returned to extension pages.
 */
export type NetworkOption = {
  readonly id: StarknetNetworkId;
  readonly name: string;
};

/**
 * Public status returned to extension pages.
 */
export type WalletStatus = VaultStatus & {
  readonly accounts: readonly AccountRef[];
  readonly network: string;
  readonly networkId: StarknetNetworkId;
  readonly networks: readonly NetworkOption[];
};

/**
 * Successful account-import response.
 */
export type CreateAccountResponse = {
  readonly account: AccountRef;
  readonly ok: true;
};

/**
 * Successful mnemonic-generation response.
 */
export type GenerateMnemonicResponse = {
  readonly mnemonic: string;
  readonly ok: true;
};

/**
 * Re-authenticated secret reveal returned only to the extension reveal flow.
 */
export type RevealSecretsResponse = {
  readonly mnemonic: string | null;
  readonly ok: true;
  readonly privateKey: string;
};

/**
 * Account list response scoped by origin grants.
 */
export type AccountsResponse = {
  readonly accounts: readonly AccountRef[];
  readonly ok: true;
};

/**
 * Successful signing response from the wallet service.
 */
export type SignHashResponse = {
  readonly ok: true;
  readonly signature: StarkSignature;
};

/**
 * Popup response containing dapp connection approvals.
 */
export type PendingApprovalResponse = {
  readonly ok: true;
  readonly pending: readonly PendingApproval[];
};

/**
 * Connected-sites response listing origin grants and their account counts.
 */
export type ConnectedSitesResponse = {
  readonly ok: true;
  readonly sites: readonly ConnectedSite[];
};

/**
 * Plain preferences response returned to extension pages.
 */
export type PreferencesResponse = {
  readonly ok: true;
  readonly preferences: WalletPreferences;
};

/**
 * Token balance response returned to extension pages.
 */
export type BalancesResponse = {
  readonly accountId: string;
  readonly balances: readonly TokenBalance[];
  readonly networkId: StarknetNetworkId;
  readonly ok: true;
};

/**
 * Selected chain id response returned through the dapp provider bridge.
 */
export type ChainIdResponse = {
  readonly chainId: string;
  readonly ok: true;
};

/**
 * Origin permission list returned through the dapp provider bridge. Contains
 * "accounts" when the origin holds a grant, otherwise an empty list.
 */
export type PermissionsResponse = {
  readonly ok: true;
  readonly permissions: readonly string[];
};

/**
 * Watch-asset outcome returned when the requested token is already tracked and
 * no approval prompt is needed.
 */
export type WatchAssetResponse = {
  readonly ok: true;
  readonly watched: true;
};

/**
 * Add-custom-chain outcome returned through the dapp provider bridge, both for
 * the already-listed fast path and after a user approves adding the chain.
 */
export type AddChainResponse = {
  readonly added: true;
  readonly ok: true;
};

/**
 * Declare submission outcome returned through the dapp provider bridge, carrying
 * the node's transaction and class hashes for padding into the dapp result.
 */
export type DeclareResponse = {
  readonly classHash: string;
  readonly ok: true;
  readonly transactionHash: string;
};

/**
 * Auto-detected token suggestions with balances returned to extension pages.
 */
export type DetectTokensResponse = {
  readonly ok: true;
  readonly suggestions: readonly TokenBalance[];
};

/**
 * Auto-discovered, on-chain-verified owned NFTs returned to extension pages.
 */
export type DiscoverNftsResponse = {
  readonly nfts: readonly DiscoveredNft[];
  readonly ok: true;
};

/**
 * Fiat prices keyed by contract address returned to extension pages.
 */
export type PricesResponse = {
  readonly currency: DisplayCurrency;
  readonly ok: true;
  readonly prices: Readonly<Record<string, number>>;
};

/**
 * Token price series for a sparkline returned to extension pages.
 */
export type TokenChartResponse = {
  readonly currency: DisplayCurrency;
  readonly ok: true;
  readonly points: readonly number[];
};

/**
 * Verified AVNU token catalog returned to extension pages for the swap
 * picker. Directory data only — a selected untracked token is re-validated
 * on-chain by the add-token flow before the wallet trusts it.
 */
export type SwapTokensResponse = {
  readonly ok: true;
  readonly swapTokens: readonly SwapCatalogToken[];
};

/**
 * Validated AVNU swap quote view returned to extension pages: display-ready
 * decimal amounts plus the USD figures for the confirmation receipt.
 */
export type SwapQuoteResponse = {
  readonly ok: true;
  readonly swapQuote: {
    readonly buyAmount: string;
    readonly buyAmountInUsd: number;
    readonly gasFeesInUsd: number;
    readonly quoteId: string;
    readonly sellAmount: string;
    readonly sellAmountInUsd: number;
  };
};

/**
 * Frozen executable swap review returned before the final one-time confirm.
 */
export type SwapPreparationResponse = {
  readonly ok: true;
  readonly swapPreparation: SwapPreparationReview;
};

/**
 * Transfer submission response returned to extension pages.
 */
export type TransferResponse = {
  readonly ok: true;
  readonly transactionHash: string;
};

/**
 * Pre-sign transfer review returned to extension pages.
 */
export type TransferReviewResponse = {
  readonly ok: true;
  readonly review: {
    readonly fee: FeeEstimate | null;
    readonly feeEstimateFailed: boolean;
    readonly flags: readonly RiskFlag[];
    readonly requiresDeployment: boolean;
    readonly summaries: readonly string[];
  };
};

/**
 * Activity feed returned to extension pages.
 */
export type ActivityResponse = {
  readonly activity: readonly ActivityEntry[];
  readonly ok: true;
};

/**
 * Tracked allowances returned to extension pages.
 */
export type AllowancesResponse = {
  readonly allowances: readonly AllowanceView[];
  readonly ok: true;
};

/**
 * Account contract deployment status returned to extension pages.
 */
export type DeploymentStatusResponse = {
  readonly accountId: string;
  readonly deployed: boolean;
  readonly ok: true;
};

/**
 * On-chain class-hash verification returned to extension pages. `verification`
 * carries the discriminated {@link ClassHashVerification} outcome so the UI can
 * distinguish verified / mismatch / undeployed / unreachable without re-reading
 * the chain.
 */
export type ClassHashVerificationResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly verification: ClassHashVerification;
};

/**
 * Supported spec or wallet-API version list returned through the dapp provider
 * bridge for the discovery methods.
 */
export type SupportedVersionsResponse = {
  readonly ok: true;
  readonly versions: readonly string[];
};

/**
 * Counterfactual ACCOUNT_DEPLOYMENT_DATA returned through the dapp provider
 * bridge; the bridge left-pads the felts before the dapp sees them.
 */
export type DeploymentDataResponse = {
  readonly deployment: {
    readonly address: string;
    readonly calldata: readonly string[];
    readonly classHash: string;
    readonly salt: string;
    readonly version: 0 | 1;
  };
  readonly ok: true;
};

/**
 * Dapp account-request response, either granted or queued for approval.
 */
export type RequestAccountsResponse =
  | AccountsResponse
  | {
      readonly ok: false;
      readonly pending: PendingApproval;
    };

/**
 * Watched multisigs and their tracked proposals for the active network.
 */
export type MultisigsResponse = {
  readonly multisigs: readonly MultisigRecord[];
  readonly ok: true;
  readonly proposals: readonly MultisigProposalRecord[];
};

/**
 * One watched multisig after an add or config refresh, with refreshed
 * proposals when the refresh path produced them.
 */
export type MultisigResponse = {
  readonly multisig: MultisigRecord;
  readonly ok: true;
  readonly proposals?: readonly MultisigProposalRecord[];
};

/**
 * One tracked proposal after a submit or track-by-id, with the submission
 * hash when a transaction was broadcast.
 */
export type MultisigProposalResponse = {
  readonly ok: true;
  readonly proposal: MultisigProposalRecord;
  readonly transactionHash?: string;
};

/**
 * Whether the pinned multisig class is declared on the active network.
 */
export type MultisigClassStatusResponse = {
  readonly declared: boolean;
  readonly ok: true;
};

/**
 * Deploy-multisig submission outcome with the predicted contract address.
 */
export type MultisigDeployResponse = {
  readonly address: string;
  readonly ok: true;
  readonly transactionHash: string;
};

/**
 * Pending device-sign requests returned to the side panel Ledger transport.
 */
export type LedgerSignPendingResponse = {
  readonly ok: true;
  readonly pending: readonly PendingLedgerSign[];
};

/**
 * One Ledger candidate's on-chain state; fields are null when degraded.
 */
export type LedgerAccountStatusResponse = {
  readonly balance: string | null;
  readonly deployed: boolean | null;
  readonly ok: true;
};

/**
 * Union of supported background message responses.
 */
export type RuntimeResponse =
  | AccountsResponse
  | ActivityResponse
  | AddChainResponse
  | AllowancesResponse
  | BalancesResponse
  | DeclareResponse
  | ChainIdResponse
  | ClassHashVerificationResponse
  | ConnectedSitesResponse
  | CreateAccountResponse
  | DeploymentDataResponse
  | DeploymentStatusResponse
  | DetectTokensResponse
  | DiscoverNftsResponse
  | SupportedVersionsResponse
  | TransferReviewResponse
  | GenerateMnemonicResponse
  | LedgerAccountStatusResponse
  | LedgerSignPendingResponse
  | MultisigClassStatusResponse
  | MultisigDeployResponse
  | MultisigProposalResponse
  | MultisigResponse
  | MultisigsResponse
  | { readonly ok: true }
  | PendingApprovalResponse
  | PermissionsResponse
  | PreferencesResponse
  | PricesResponse
  | RequestAccountsResponse
  | RevealSecretsResponse
  | SignHashResponse
  | Strk20BalancesResponse
  | Strk20PrepareResponse
  | Strk20SubaccountCommitmentResponse
  | Strk20WalletPreparationResponse
  | Strk20WalletStateResponse
  | SwapQuoteResponse
  | SwapPreparationResponse
  | SwapTokensResponse
  | TokenChartResponse
  | TransferResponse
  | WalletStatus
  | WatchAssetResponse
  | { readonly error: string };

/**
 * Narrow wallet service surface consumed by background message dispatch.
 */
export type WalletStatusReader = {
  readonly addDerivedAccount: (input: AddDerivedAccountInput) => Promise<AccountRef>;
  /** Stores a keyless Ledger account; optional only for partial test stubs. */
  readonly addLedgerAccount?: (input: AddLedgerAccountInput) => Promise<LedgerAccountRef>;
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<AccountRef>;
  /** Creates a mnemonic-less Ledger vault; fails closed over an existing vault. */
  readonly createLedgerVault?: (input: CreateLedgerVaultInput) => Promise<LedgerAccountRef>;
  /** Derives Ledger picker candidates; optional only for partial test stubs. */
  readonly deriveLedgerAccounts?: (
    input: DeriveLedgerAccountsInput,
  ) => Promise<readonly LedgerAccountRef[]>;
  /** Privileged, scoped STRK20 viewing-key derivation. Production fails closed
   * when this optional-for-test-stubs boundary is absent. */
  readonly deriveStrk20ViewingKey?: (input: {
    readonly accountId: string;
    readonly chainId: string;
    readonly poolAddress: string;
    readonly vaultPassphrase: string;
  }) => Promise<string>;
  readonly ensureNetworkAccount: (input: EnsureNetworkAccountInput) => Promise<AccountRef>;
  readonly generateMnemonic: () => Promise<string>;
  /**
   * Imports an account from a raw private key. Optional on this narrow dispatch
   * type so partial test stubs stay valid; the wired vault service always
   * provides it.
   */
  readonly importRawKeyAccount?: (input: ImportRawKeyAccountInput) => Promise<AccountRef>;
  /** Derives public metadata without writing; optional only for partial test stubs. */
  readonly previewAccount?: (input: AccountDerivationInput) => Promise<AccountRef>;
  readonly getGrantedAccounts: (
    origin: string,
    vaultPassphrase: string,
  ) => Promise<readonly AccountRef[]>;
  readonly grantOrigin: (input: OriginGrantInput) => Promise<readonly AccountRef[]>;
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
  /** Removes origin grants; optional only for partial test stubs. */
  readonly revokeOrigin?: (input: RevokeOriginInput) => Promise<readonly ConnectedSite[]>;
  readonly setActiveAccount: (input: SetActiveAccountInput) => Promise<AccountRef>;
  readonly signHash: (input: SignHashInput) => Promise<StarkSignature>;
  readonly status: () => Promise<VaultStatus>;
};
