/** Shared background runtime response and service types. */
import type {
  ArgentMultisigAuthorityStatus,
  ArgentMultisigConfig,
  ArgentUnsupportedSigner,
} from "@bramble/multisig/chain";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import type { MultisigSignerAccount } from "@bramble/multisig/signer-account";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import type { FeeEstimate, TokenBalance } from "@bramble/starknet/rpc";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { AllowanceNotice, AllowanceView } from "@bramble/transactions/allowance-discovery";
import type { SwapCatalogToken } from "@bramble/transactions/avnu";
import type { ConnectedSite } from "@bramble/vault/service";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { ReadOnlyReason, RecoveryAccountCandidate } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "@bramble/wallet-protocol/extension-responses";
import type { PrivacyBlockerKind } from "@bramble/wallet-protocol/privacy-blocker";
import type { SubmissionUnknownResponse } from "@bramble/wallet-protocol/submission-unknown";
import type { PendingApproval } from "../approvals/approvals";
import type { PendingLedgerSign } from "../ledger/ledger-sign-queue";
import type {
  ArgentMultisigDeploymentReview,
  ArgentMultisigIntentPackage,
} from "../multisig/multisig-inputs";
import type {
  Strk20BalancesResponse,
  Strk20PrepareResponse,
  Strk20RecipientStatusResponse,
  Strk20ShadowAccountBalancesResponse,
  Strk20ShadowAccountCommitmentResponse,
  Strk20ShadowAccountsResponse,
  Strk20WalletPreparationResponse,
  Strk20WalletStateResponse,
} from "../privacy/runtime-strk20-types";
import type { SupportDiagnosticsResponse } from "../support/diagnostics";
import type { SwapPreparationReview } from "../transactions/swap-preparations";
import type { NostrCoordinationResponse } from "./nostr-types";
import type {
  AccountRecoveryState,
  RecoverAccountResponse,
  RecoveryReviewResponse,
} from "./recovery-types";
import type {
  ClassHashVerificationResponse,
  StarkNameResolutionResponse,
} from "./runtime-lookup-types";
import type {
  FeeReviewResponse,
  TransferResponse,
  TransferReviewResponse,
} from "./runtime-review-types";

/** Successful account-import response. */
type CreateAccountResponse = {
  readonly account: AccountRef;
  readonly ok: true;
};

/**
 * Successful mnemonic-generation response.
 */
type GenerateMnemonicResponse = {
  readonly mnemonic: string;
  readonly ok: true;
};

/**
 * Successful mnemonic-validity response. Carries only the boolean verdict.
 */
type ValidateMnemonicResponse = {
  readonly ok: true;
  readonly valid: boolean;
};

/**
 * Re-authenticated secret reveal returned only to the extension reveal flow.
 */
type RevealSecretsResponse = {
  readonly mnemonic: string | null;
  readonly ok: true;
  /** `null` on a network with no account: only the recovery phrase is revealed. */
  readonly privateKey: string | null;
};

/**
 * Account list response scoped by origin grants.
 */
type AccountsResponse = {
  readonly accounts: readonly AccountRef[];
  readonly ok: true;
};

/**
 * Successful signing response from the wallet service.
 */
type SignHashResponse = {
  readonly ok: true;
  readonly signature: readonly string[];
};

/**
 * Popup response containing dapp connection approvals.
 */
type PendingApprovalResponse = {
  readonly ok: true;
  readonly pending: readonly PendingApproval[];
};

/**
 * Connected-sites response listing origin grants and their account counts.
 */
type ConnectedSitesResponse = {
  readonly ok: true;
  readonly sites: readonly ConnectedSite[];
};

/**
 * Plain preferences response returned to extension pages.
 */
type PreferencesResponse = {
  readonly ok: true;
  readonly preferences: WalletPreferences;
};

/**
 * Token balance response returned to extension pages.
 */
type BalancesResponse = {
  readonly accountId: string;
  readonly asOf: number | null;
  readonly balances: readonly TokenBalance[];
  readonly networkId: StarknetNetworkId;
  readonly ok: true;
  readonly stale: boolean;
};

/**
 * Selected chain id response returned through the dapp provider bridge.
 */
type ChainIdResponse = {
  readonly chainId: string;
  readonly ok: true;
};

/**
 * Origin permission list returned through the dapp provider bridge. Contains
 * "accounts" when the origin holds a grant, otherwise an empty list.
 */
type PermissionsResponse = {
  readonly ok: true;
  readonly permissions: readonly string[];
};

/**
 * Watch-asset outcome returned once the user approves the card, or closes the
 * already-tracked notice (audit M1). Never returned before the user acts.
 */
type WatchAssetResponse = {
  readonly ok: true;
  readonly watched: true;
};

/**
 * Add-custom-chain outcome returned through the dapp provider bridge, both for
 * the already-listed fast path and after a user approves adding the chain.
 */
type AddChainResponse = {
  readonly added: true;
  readonly ok: true;
};

/**
 * Declare submission outcome returned through the dapp provider bridge, carrying
 * the node's transaction and class hashes for padding into the dapp result.
 */
type DeclareResponse = {
  readonly classHash: string;
  readonly ok: true;
  readonly transactionHash: string;
};

/**
 * Auto-detected token suggestions with balances returned to extension pages.
 */
type DetectTokensResponse = {
  readonly ok: true;
  readonly suggestions: readonly TokenBalance[];
};

/**
 * Auto-discovered, on-chain-verified owned NFTs returned to extension pages.
 */
type DiscoverNftsResponse = {
  readonly nfts: readonly DiscoveredNft[];
  readonly ok: true;
};

/**
 * Fiat prices keyed by contract address returned to extension pages.
 */
type PricesResponse = {
  readonly currency: DisplayCurrency;
  readonly ok: true;
  readonly prices: Readonly<Record<string, number>>;
};

/**
 * Token price series for a sparkline returned to extension pages.
 */
type TokenChartResponse = {
  readonly currency: DisplayCurrency;
  readonly ok: true;
  readonly points: readonly number[];
};

/**
 * Verified AVNU token catalog for the swap picker. Directory data only — a
 * selected untracked token is re-validated on-chain before the wallet trusts it.
 */
type SwapTokensResponse = {
  readonly ok: true;
  readonly swapTokens: readonly SwapCatalogToken[];
};

/**
 * Validated AVNU swap quote view returned to extension pages: display-ready
 * decimal amounts plus the USD figures for the confirmation receipt.
 */
type SwapQuoteResponse = {
  readonly ok: true;
  readonly swapQuote: {
    readonly buyAmount: string;
    readonly buyAmountInUsd: number;
    readonly gasFeesInUsd: number;
    readonly quoteId: string;
    readonly sellAmount: string;
    readonly sellAmountInUsd: number;
    // Value delta priced from the wallet's own feed (Sherlock 137); absent
    // when the feed has no price for either token.
    readonly valueDeltaPercent?: number;
  };
};

/**
 * Frozen executable swap review returned before the final one-time confirm.
 */
type SwapPreparationResponse = {
  readonly ok: true;
  readonly swapPreparation: SwapPreparationReview;
};

/**
 * Activity feed returned to extension pages.
 */
type ActivityResponse = {
  readonly activity: readonly ActivityEntry[];
  readonly ok: true;
};

/**
 * Undelivered transaction failure notices returned to extension pages. Each
 * notice is handed out exactly once, so an empty list is the normal case.
 */
type TransactionAlertsResponse = {
  readonly alerts: readonly string[];
  readonly ok: true;
};

/**
 * Tracked allowances returned to extension pages.
 */
type AllowancesResponse = {
  readonly allowances: readonly AllowanceView[];
  readonly notices?: readonly AllowanceNotice[];
  readonly ok: true;
};

/**
 * Account contract deployment status returned to extension pages.
 */
type DeploymentStatusResponse = {
  readonly accountId: string;
  readonly deployed: boolean;
  readonly ok: true;
};

/**
 * Active-account signability verdict for the Home read-only flag; `reason`
 * accompanies `readOnly: true` and never carries secret material.
 */
type AccountSignabilityResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly readOnly: boolean;
  readonly reason?: ReadOnlyReason;
  readonly recovery?: AccountRecoveryState;
};

/**
 * Supported spec or wallet-API version list returned through the dapp provider
 * bridge for the discovery methods.
 */
type SupportedVersionsResponse = {
  readonly ok: true;
  readonly versions: readonly string[];
};

/**
 * Counterfactual ACCOUNT_DEPLOYMENT_DATA returned through the dapp provider
 * bridge; the bridge left-pads the felts before the dapp sees them.
 */
type DeploymentDataResponse = {
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
type RequestAccountsResponse =
  | AccountsResponse
  | {
      readonly ok: false;
      readonly pending: PendingApproval;
    };

/**
 * Fresh chain view paired with immutable Argent account provenance.
 */
type ArgentMultisigView = {
  readonly authorityStatus: ArgentMultisigAuthorityStatus;
  readonly config: ArgentMultisigConfig | null;
  readonly deployed: boolean | null;
  readonly record: ArgentMultisigRecord;
  readonly unsupportedSigners: readonly ArgentUnsupportedSigner[];
};

/** Watched Argent accounts and frozen intents for the active network. */
type MultisigsResponse = {
  readonly intents: readonly ArgentMultisigSigningIntent[];
  readonly multisigs: readonly ArgentMultisigView[];
  readonly ok: true;
};

/** One watched Argent account after add or config refresh. */
type MultisigResponse = {
  readonly intents?: readonly ArgentMultisigSigningIntent[];
  readonly multisig: ArgentMultisigView;
  readonly ok: true;
};

/** One exact frozen intent after preparation, import, or signature collection. */
type ArgentMultisigIntentResponse = {
  readonly feeReview?: FeeEstimate;
  readonly intent: ArgentMultisigSigningIntent;
  readonly intentPackage?: ArgentMultisigIntentPackage;
  readonly ok: true;
  readonly transactionHash?: string;
};

/**
 * Whether the pinned multisig class is declared on the active network.
 */
type MultisigClassStatusResponse = {
  readonly declared: boolean;
  readonly ok: true;
};

/** Exact constructor, signer, network, address, and fee bound for deployment. */
type ArgentMultisigDeploymentReviewResponse = {
  readonly deploymentReview: ArgentMultisigDeploymentReview;
  readonly ok: true;
};

/** Stable Argent deployment submission outcome. */
type MultisigDeployResponse = {
  readonly address: string;
  readonly multisig: ArgentMultisigView;
  readonly ok: true;
  readonly transactionHash: string;
};

/** Token balances scoped to a watched shared account. */
type MultisigBalancesResponse = {
  readonly accountId: string;
  readonly asOf: number | null;
  readonly balances: readonly TokenBalance[];
  readonly networkId: StarknetNetworkId;
  readonly ok: true;
  readonly stale: boolean;
};

type LedgerSignPendingResponse = {
  readonly ok: true;
  readonly pending: readonly PendingLedgerSign[];
};

/**
 * One Ledger candidate's on-chain state; fields are null when degraded.
 */
type LedgerAccountStatusResponse = {
  readonly balance: string | null;
  readonly deployed: boolean | null;
  readonly funded: boolean | null;
  readonly ok: true;
};

/**
 * Union of supported background message responses.
 */
export type RuntimeResponse =
  | AccountSignabilityResponse
  | RecoveryReviewResponse
  | RecoverAccountResponse
  | AccountsResponse
  | ActivityResponse
  | AddChainResponse
  | AllowancesResponse
  | BalancesResponse
  | DeclareResponse
  | ChainIdResponse
  | ClassHashVerificationResponse
  | StarkNameResolutionResponse
  | ConnectedSitesResponse
  | CreateAccountResponse
  | DeploymentDataResponse
  | DeploymentStatusResponse
  | DetectTokensResponse
  | DiscoverNftsResponse
  | {
      readonly candidates: readonly RecoveryAccountCandidate[];
      readonly complete: boolean;
      readonly nextIndex: number;
      readonly ok: true;
    }
  | FeeReviewResponse
  | SupportedVersionsResponse
  | TransferReviewResponse
  | GenerateMnemonicResponse
  | LedgerAccountStatusResponse
  | LedgerSignPendingResponse
  | ArgentMultisigDeploymentReviewResponse
  | ArgentMultisigIntentResponse
  | MultisigBalancesResponse
  | MultisigClassStatusResponse
  | MultisigDeployResponse
  | MultisigResponse
  | NostrCoordinationResponse
  | { readonly ok: true; readonly signer: MultisigSignerAccount }
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
  | Strk20RecipientStatusResponse
  | Strk20ShadowAccountBalancesResponse
  | Strk20ShadowAccountCommitmentResponse
  | Strk20ShadowAccountsResponse
  | Strk20WalletPreparationResponse
  | Strk20WalletStateResponse
  | SupportDiagnosticsResponse
  | SwapQuoteResponse
  | SwapPreparationResponse
  | SwapTokensResponse
  | TokenChartResponse
  | TransactionAlertsResponse
  | TransferResponse
  | SubmissionUnknownResponse
  | ValidateMnemonicResponse
  | WalletStatus
  | WatchAssetResponse
  | { readonly error: string; readonly privacyBlocker?: PrivacyBlockerKind };
