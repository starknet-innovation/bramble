/**
 * Public schema and capability types for the plain preferences store.
 */
import type { StarknetNetworkId } from "../starknet/networks";
import type { AccountGroupIcon, AccountGroups } from "./account-groups";
import type { CustomNetwork } from "./custom-network";
import type { WatchedNft } from "./nft";
import type {
  AccountLabels,
  AddressBookEntry,
  DisplayCurrency,
  RpcOverrides,
  ThemeChoice,
  TokenConfig,
} from "./preferences-entries";

/**
 * Current plain preferences schema. Optional fields keep preferences stored
 * before they existed validating.
 */
export type WalletPreferences = {
  readonly accountLabels?: AccountLabels;
  readonly activeNetworkId: StarknetNetworkId;
  readonly addressBook: readonly AddressBookEntry[];
  readonly customNetworks?: readonly CustomNetwork[];
  readonly displayCurrency?: DisplayCurrency;
  readonly groups?: AccountGroups;
  readonly hiddenTokens?: readonly string[];
  readonly nftIndexerUrl?: string;
  readonly nfts?: readonly WatchedNft[];
  readonly rpcOverrides?: RpcOverrides;
  readonly schemaVersion: 1;
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
    readonly displayCurrency?: DisplayCurrency;
    readonly theme?: ThemeChoice;
  }) => Promise<WalletPreferences>;
  readonly setRpcOverride: (input: {
    readonly networkId: StarknetNetworkId;
    readonly rpcUrl: string;
  }) => Promise<WalletPreferences>;
  readonly setStrk20ProverUrl: (input: { readonly url: string }) => Promise<WalletPreferences>;
  readonly setTokenHidden: (input: {
    readonly hidden: boolean;
    readonly tokenId: string;
  }) => Promise<WalletPreferences>;
  readonly upsertToken: (token: Omit<TokenConfig, "id">) => Promise<WalletPreferences>;
};
