/**
 * Shared background runtime response and service types.
 */
import type { StarkSignature } from "../crypto/krusty";
import type { StarknetNetworkId } from "../starknet/networks";
import type { FeeEstimate, TokenBalance } from "../starknet/rpc";
import type { RiskFlag } from "../starknet/verify";
import type { ActivityEntry } from "../storage/activity-store";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef, Vault } from "../storage/vault-schema";
import type {
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
 * Account contract deployment status returned to extension pages.
 */
export type DeploymentStatusResponse = {
  readonly accountId: string;
  readonly deployed: boolean;
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
  | BalancesResponse
  | ChainIdResponse
  | ConnectedSitesResponse
  | CreateAccountResponse
  | DeploymentStatusResponse
  | DetectTokensResponse
  | TransferReviewResponse
  | GenerateMnemonicResponse
  | PendingApprovalResponse
  | PermissionsResponse
  | PreferencesResponse
  | PricesResponse
  | RequestAccountsResponse
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
