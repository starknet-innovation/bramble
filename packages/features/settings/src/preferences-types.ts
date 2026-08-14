/**
 * Public schema and capability types for the plain preferences store.
 */

import type { WatchedNft } from "@mc-wallet/portfolio/watched-nft";
import type { Strk20NetworkConfig, Strk20NetworkConfigs } from "@mc-wallet/privacy/config";
import type { CustomNetwork } from "@mc-wallet/wallet-model/custom-network";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type {
  AccountLabels,
  AddressBookEntry,
  ApprovalSurfacePreference,
  DisplayCurrency,
  ExplorerFallback,
  RpcOverrides,
  ThemeChoice,
  TokenConfig,
} from "@mc-wallet/wallet-model/preferences";
import type { AccountGroupIcon, AccountGroups } from "./groups";

/**
 * Current plain preferences schema. Optional fields keep preferences stored
 * before they existed validating.
 */
export type WalletPreferences = {
  readonly accountLabels?: AccountLabels;
  readonly activeNetworkId: StarknetNetworkId;
  readonly approvalSurface?: ApprovalSurfacePreference;
  readonly addressBook: readonly AddressBookEntry[];
  readonly customNetworks?: readonly CustomNetwork[];
  readonly displayCurrency?: DisplayCurrency;
  /**
   * Per-network opt-in for the third-party explorer read lane. Absent (or
   * absent for one network) means "never decided", which the wallet resolves
   * through `explorerFallbackAllowed` rather than by writing a value here.
   */
  readonly explorerFallback?: ExplorerFallback;
  readonly groups?: AccountGroups;
  readonly hiddenTokens?: readonly string[];
  readonly nftIndexerUrl?: string;
  readonly nfts?: readonly WatchedNft[];
  readonly rpcOverrides?: RpcOverrides;
  readonly schemaVersion: 1;
  readonly strk20Networks?: Strk20NetworkConfigs;
  /** @deprecated Legacy incomplete prover-only setting retained for backup compatibility. */
  readonly strk20ProverUrl?: string;
  readonly theme?: ThemeChoice;
  readonly tokens: readonly TokenConfig[];
};

/**
 * Plain preferences store methods exposed to the background worker.
 */
export type WalletPreferencesStore = {
  readonly addCustomNetwork: (network: CustomNetwork) => Promise<WalletPreferences>;
  readonly addNft: (nft: Omit<WatchedNft, "id">) => Promise<WalletPreferences>;
  readonly createGroup: (input: {
    readonly icon: AccountGroupIcon;
    readonly name: string;
  }) => Promise<WalletPreferences>;
  readonly importPreferences: (candidate: unknown) => Promise<WalletPreferences>;
  readonly read: () => Promise<WalletPreferences>;
  readonly removeAddress: (id: string) => Promise<WalletPreferences>;
  readonly removeGroup: (input: { readonly id: string }) => Promise<WalletPreferences>;
  readonly removeNft: (id: string) => Promise<WalletPreferences>;
  readonly renameGroup: (input: {
    readonly id: string;
    readonly name: string;
  }) => Promise<WalletPreferences>;
  readonly saveAddress: (entry: Omit<AddressBookEntry, "id">) => Promise<WalletPreferences>;
  readonly setAccountInGroup: (input: {
    readonly accountId: string;
    readonly groupId: string;
    readonly member: boolean;
  }) => Promise<WalletPreferences>;
  /**
   * Records an explicit per-network choice about the third-party explorer read
   * lane. Writing `true` accepts that the account address is disclosed to the
   * explorer once every configured RPC has failed; `false` refuses the lane on
   * that network. There is deliberately no "clear" case: once the user has
   * decided, the derived default never silently takes the decision back.
   */
  readonly setExplorerFallback: (input: {
    readonly enabled: boolean;
    readonly networkId: StarknetNetworkId;
  }) => Promise<WalletPreferences>;
  readonly setGroupIcon: (input: {
    readonly icon: AccountGroupIcon;
    readonly id: string;
  }) => Promise<WalletPreferences>;
  readonly setNftIndexerUrl: (input: { readonly url: string }) => Promise<WalletPreferences>;
  readonly setNftSpam: (input: {
    readonly id: string;
    readonly spam: boolean;
  }) => Promise<WalletPreferences>;
  readonly setAccountLabel: (input: {
    readonly accountId: string;
    readonly label: string;
  }) => Promise<WalletPreferences>;
  readonly setActiveNetwork: (networkId: StarknetNetworkId) => Promise<WalletPreferences>;
  readonly setDisplay: (input: {
    readonly approvalSurface?: ApprovalSurfacePreference;
    readonly displayCurrency?: DisplayCurrency;
    readonly theme?: ThemeChoice;
  }) => Promise<WalletPreferences>;
  readonly setRpcOverride: (input: {
    readonly networkId: StarknetNetworkId;
    readonly rpcUrl: string;
  }) => Promise<WalletPreferences>;
  readonly setStrk20NetworkConfig: (input: {
    readonly config: Strk20NetworkConfig | null;
    readonly networkId: StarknetNetworkId;
  }) => Promise<WalletPreferences>;
  readonly setTokenHidden: (input: {
    readonly hidden: boolean;
    readonly tokenId: string;
  }) => Promise<WalletPreferences>;
  readonly upsertToken: (token: Omit<TokenConfig, "id">) => Promise<WalletPreferences>;
};
