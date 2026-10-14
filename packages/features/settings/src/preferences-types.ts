/**
 * Public schema and capability types for the plain preferences store.
 */

import type { WatchedNft } from "@bramble/portfolio/watched-nft";
import type { Strk20NetworkConfig, Strk20NetworkConfigs } from "@bramble/privacy/config";
import type { CustomNetwork } from "@bramble/wallet-model/custom-network";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type {
  AccountLabels,
  AddressBookEntry,
  ApprovalSurfacePreference,
  DisplayCurrency,
  ExplorerApiOverrides,
  ExplorerFallback,
  RpcOverrides,
  ThemeChoice,
  TokenConfig,
} from "@bramble/wallet-model/preferences";
import type { AccountGroupIcon, AccountGroups } from "./groups";

/** Who added a tracked token: a dapp (wallet_watchAsset) or the user. */
export type TokenSource = "dapp" | "user";

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
  /**
   * Ids of tracked tokens a dapp added (wallet_watchAsset) and the user has not
   * added themselves since. Their metadata came from the site, so the call
   * reviewer does not trust them unless they match a curated token. Absent on
   * preferences written before the field existed (those tokens stay trusted).
   */
  readonly dappTokenIds?: readonly string[];
  readonly displayCurrency?: DisplayCurrency;
  /** Per-network Starkscan-compatible read API override. */
  readonly explorerApiUrls?: ExplorerApiOverrides;
  /**
   * Per-network opt-in for the third-party explorer read lane. Absent (or
   * absent for one network) means "never decided", which the wallet resolves
   * through `explorerFallbackAllowed` rather than by writing a value here.
   */
  readonly explorerFallback?: ExplorerFallback;
  readonly groups?: AccountGroups;
  /**
   * Ids of accounts the user has hidden. A hidden account leaves the account
   * drawer and the Send/Receive pickers but keeps its grants and its signing
   * material: hiding is a view filter, not a permission change, so it lives
   * here rather than in the vault and needs no schema migration.
   */
  readonly hiddenAccountIds?: readonly string[];
  readonly hiddenTokens?: readonly string[];
  readonly nftIndexerUrl?: string;
  /**
   * Tokens the user removed, as `networkId:address`, so the curated held-token
   * scan never tracks one again (issue 663). Bounded; adding the token again
   * lifts the entry. Absent on preferences written before the field existed.
   */
  readonly removedTokens?: readonly string[];
  readonly nfts?: readonly WatchedNft[];
  /** Custom relay replacing the reviewed Nostr defaults for explicit multisig handoffs. */
  readonly nostrRelayUrl?: string;
  /** User-controllable pseudonymous usage metadata sent only to the wallet-owned gateway. */
  readonly productAnalytics?: boolean;
  readonly rpcOverrides?: RpcOverrides;
  /** Opt-in process-local aggregate RPC counters; never uploaded automatically. */
  readonly reliabilityDiagnostics?: boolean;
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
  /**
   * Removes a tracked token that is not a built-in default, with its hidden
   * flag. Throws for an unknown id or a default token.
   */
  readonly removeToken: (input: { readonly tokenId: string }) => Promise<WalletPreferences>;
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
    readonly apiUrl?: string;
    readonly enabled: boolean;
    readonly networkId: StarknetNetworkId;
  }) => Promise<WalletPreferences>;
  readonly setGroupIcon: (input: {
    readonly icon: AccountGroupIcon;
    readonly id: string;
  }) => Promise<WalletPreferences>;
  readonly setNftIndexerUrl: (input: { readonly url: string }) => Promise<WalletPreferences>;
  readonly setNostrRelayUrl: (input: { readonly relayUrl: string }) => Promise<WalletPreferences>;
  readonly setNftSpam: (input: {
    readonly id: string;
    readonly spam: boolean;
  }) => Promise<WalletPreferences>;
  /**
   * Hides or reveals one account. Hiding is refused for the last account a
   * network would still show, and the background switches the active account
   * away before hiding it, so no list ever opens on an account it omits.
   */
  readonly setAccountHidden: (input: {
    readonly accountId: string;
    readonly hidden: boolean;
  }) => Promise<WalletPreferences>;
  readonly setAccountLabel: (input: {
    readonly accountId: string;
    readonly label: string;
  }) => Promise<WalletPreferences>;
  readonly setActiveNetwork: (networkId: StarknetNetworkId) => Promise<WalletPreferences>;
  readonly setDisplay: (input: {
    readonly approvalSurface?: ApprovalSurfacePreference;
    readonly displayCurrency?: DisplayCurrency;
    readonly productAnalytics?: boolean;
    readonly reliabilityDiagnostics?: boolean;
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
  /**
   * Adds or replaces a tracked token. `source` records who added it: "dapp"
   * marks it as dapp-supplied in `dappTokenIds`, "user" (an explicit add in the
   * wallet) clears that mark. Required so no caller trusts a token by omission.
   */
  readonly upsertToken: (
    token: Omit<TokenConfig, "id">,
    source: TokenSource,
  ) => Promise<WalletPreferences>;
};
