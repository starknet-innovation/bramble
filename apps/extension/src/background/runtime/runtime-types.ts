/**
 * Shared background runtime response and service types.
 */

import type { MultisigConfirmationMode } from "@mc-wallet/multisig/confirmation";
import type { MultisigProposalRecord, MultisigRecord } from "@mc-wallet/multisig/repository";
import type { MultisigSyncWarning } from "@mc-wallet/multisig/sync";
import type { DiscoveredNft } from "@mc-wallet/portfolio/nft-metadata";
import type { DisplayCurrency, WalletPreferences } from "@mc-wallet/settings/preferences";
import type { ClassHashVerification } from "@mc-wallet/starknet/class-hash-verify";
import type { FeeEstimate, TokenBalance } from "@mc-wallet/starknet/rpc";
import type { ActivityEntry } from "@mc-wallet/transactions/activity";
import type { AllowanceView } from "@mc-wallet/transactions/allowance-discovery";
import type { SwapCatalogToken } from "@mc-wallet/transactions/avnu";
import type { RiskFlag } from "@mc-wallet/transactions/verify";
import type { ConnectedSite } from "@mc-wallet/vault/service";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import type { WalletStatus } from "@mc-wallet/wallet-protocol/extension-responses";
import type { PendingApproval } from "../approvals/approvals";
import type { PendingLedgerSign } from "../ledger/ledger-sign-queue";
import type {
  Strk20BalancesResponse,
  Strk20PrepareResponse,
  Strk20RecipientStatusResponse,
  Strk20SubaccountCommitmentResponse,
  Strk20WalletPreparationResponse,
  Strk20WalletStateResponse,
} from "../privacy/runtime-strk20-types";
import type { SwapPreparationReview } from "../transactions/swap-preparations";

/**
 * Shared wallet status and network response shapes returned to extension pages.
 */
export type { NetworkOption, WalletStatus } from "@mc-wallet/wallet-protocol/extension-responses";

/**
 * Successful account-import response.
 */
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
 * Re-authenticated secret reveal returned only to the extension reveal flow.
 */
type RevealSecretsResponse = {
  readonly mnemonic: string | null;
  readonly ok: true;
  readonly privateKey: string;
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
  readonly signature: StarkSignature;
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
  readonly balances: readonly TokenBalance[];
  readonly networkId: StarknetNetworkId;
  readonly ok: true;
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
 * Watch-asset outcome returned when the requested token is already tracked and
 * no approval prompt is needed.
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
 * Verified AVNU token catalog returned to extension pages for the swap
 * picker. Directory data only — a selected untracked token is re-validated
 * on-chain by the add-token flow before the wallet trusts it.
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
 * Transfer submission response returned to extension pages.
 */
type TransferResponse = {
  readonly ok: true;
  readonly transactionHash: string;
};

/**
 * Pre-sign transfer review returned to extension pages.
 */
type TransferReviewResponse = {
  readonly ok: true;
  readonly review: {
    readonly deploymentFee?: FeeEstimate | null;
    readonly deploymentFeeEstimateFailed?: boolean;
    readonly fee: FeeEstimate | null;
    /**
     * Warn-only fee-affordability verdict from the shared predicate (issue
     * 191); "unknown" means no claim was possible and must never block.
     */
    readonly feeAffordability: "insufficient" | "ok" | "unknown";
    readonly feeEstimateFailed: boolean;
    readonly flags: readonly RiskFlag[];
    readonly requiresDeployment: boolean;
    readonly summaries: readonly string[];
  };
};

/** Fee a wallet-initiated operation must display before its confirmation. */
type FeeReviewResponse = {
  readonly feeReview: FeeEstimate;
  readonly ok: true;
};

/**
 * Pre-sign fee review for one exact multisig confirmation operation.
 */
type MultisigConfirmationReviewResponse = {
  readonly confirmationReview: {
    readonly fee: FeeEstimate | null;
    readonly feeEstimateFailed: boolean;
    readonly mode: MultisigConfirmationMode;
    readonly proposalId: string;
    readonly signerAccountId: string;
  };
  readonly ok: true;
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
 * On-chain class-hash verification returned to extension pages. `verification`
 * carries the discriminated {@link ClassHashVerification} outcome so the UI can
 * distinguish verified / mismatch / undeployed / unreachable without re-reading
 * the chain.
 */
type ClassHashVerificationResponse = {
  readonly accountId: string;
  readonly ok: true;
  readonly verification: ClassHashVerification;
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
 * Watched multisigs and their tracked proposals for the active network.
 */
type MultisigsResponse = {
  readonly multisigs: readonly MultisigRecord[];
  readonly ok: true;
  readonly proposals: readonly MultisigProposalRecord[];
};
/**
 * One watched multisig after an add or config refresh.
 */
type MultisigResponse = {
  readonly multisig: MultisigRecord;
  readonly ok: true;
  readonly proposals?: readonly MultisigProposalRecord[];
  readonly warnings?: readonly MultisigSyncWarning[];
};

/**
 * One tracked proposal after a submit or track-by-id, with the submission
 * hash when a transaction was broadcast.
 */
type MultisigProposalResponse = {
  readonly ok: true;
  readonly proposal: MultisigProposalRecord;
  readonly transactionHash?: string;
};

/**
 * Whether the pinned multisig class is declared on the active network.
 */
type MultisigClassStatusResponse = {
  readonly declared: boolean;
  readonly declarationPending: boolean;
  readonly ok: true;
  readonly transactionHash?: string;
};
/**
 * Deploy-multisig submission outcome with the predicted contract address.
 */
type MultisigDeployResponse = {
  readonly address: string;
  readonly ok: true;
  readonly tracked: boolean;
  readonly transactionHash: string;
};

/**
 * Pending device-sign requests returned to the side panel Ledger transport.
 */
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
  | FeeReviewResponse
  | SupportedVersionsResponse
  | TransferReviewResponse
  | GenerateMnemonicResponse
  | LedgerAccountStatusResponse
  | LedgerSignPendingResponse
  | MultisigClassStatusResponse
  | MultisigConfirmationReviewResponse
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
  | Strk20RecipientStatusResponse
  | Strk20SubaccountCommitmentResponse
  | Strk20WalletPreparationResponse
  | Strk20WalletStateResponse
  | SwapQuoteResponse
  | SwapPreparationResponse
  | SwapTokensResponse
  | TokenChartResponse
  | TransactionAlertsResponse
  | TransferResponse
  | WalletStatus
  | WatchAssetResponse
  | { readonly error: string };
