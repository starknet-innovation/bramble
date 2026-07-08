/**
 * Shared background runtime response and service types.
 */
import type { StarkSignature } from "../crypto/krusty";
import type { StarknetNetworkId } from "../starknet/networks";
import type { FeeEstimate, TokenBalance } from "../starknet/rpc";
import type { RiskFlag } from "../starknet/verify";
import type { ActivityEntry } from "../storage/activity-store";
import type { AllowanceRecord } from "../storage/allowance-store";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef, Vault } from "../storage/vault-schema";
import type {
  AddDerivedAccountInput,
  ConnectedSite,
  CreateVaultAccountInput,
  EnsureNetworkAccountInput,
  OriginGrantInput,
  RevokeOriginInput,
  SetActiveAccountInput,
  SignHashInput,
  WalletStatus as VaultStatus,
} from "../wallet/vault-service";
import type { PendingApproval } from "./approvals";

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
 * Auto-detected token suggestions with balances returned to extension pages.
 */
export type DetectTokensResponse = {
  readonly ok: true;
  readonly suggestions: readonly TokenBalance[];
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
  readonly allowances: readonly AllowanceRecord[];
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
 * Union of supported background message responses.
 */
export type RuntimeResponse =
  | AccountsResponse
  | ActivityResponse
  | AllowancesResponse
  | BalancesResponse
  | ChainIdResponse
  | ConnectedSitesResponse
  | CreateAccountResponse
  | DeploymentDataResponse
  | DeploymentStatusResponse
  | DetectTokensResponse
  | SupportedVersionsResponse
  | TransferReviewResponse
  | GenerateMnemonicResponse
  | PendingApprovalResponse
  | PermissionsResponse
  | PreferencesResponse
  | PricesResponse
  | RequestAccountsResponse
  | RevealSecretsResponse
  | SignHashResponse
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
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<AccountRef>;
  readonly ensureNetworkAccount: (input: EnsureNetworkAccountInput) => Promise<AccountRef>;
  readonly generateMnemonic: () => Promise<string>;
  readonly getGrantedAccounts: (
    origin: string,
    vaultPassphrase: string,
  ) => Promise<readonly AccountRef[]>;
  readonly grantOrigin: (input: OriginGrantInput) => Promise<readonly AccountRef[]>;
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
  /**
   * Removes an origin's grants. Optional on this narrow dispatch type so
   * partial test stubs stay valid; the wired vault service always provides it.
   */
  readonly revokeOrigin?: (input: RevokeOriginInput) => Promise<readonly ConnectedSite[]>;
  readonly setActiveAccount: (input: SetActiveAccountInput) => Promise<AccountRef>;
  readonly signHash: (input: SignHashInput) => Promise<StarkSignature>;
  readonly status: () => Promise<VaultStatus>;
};
