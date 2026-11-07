import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { AllowanceNotice, AllowanceView } from "@bramble/transactions/allowance-discovery";
import type {
  AllowanceListing,
  ArgentMultisigView,
  BalanceState,
  ConnectedSite,
  DiscoveredNft,
  PendingApproval,
  PrivacyDisclosureState,
  PrivacyJourneyState,
  SignabilityVerdict,
  StakingState,
  WalletStatus,
} from "@bramble/wallet-ui/lab";
import { dashboard, type WalletView } from "@bramble/wallet-ui/lab";
import {
  balances,
  discoveredNft,
  preferences,
  softwareActivity,
  statusFor,
  USDC_ADDRESS,
} from "../fixtures/fixtures";

// A staking state with no stakes, used when a checkpoint opens a Home tab
// without describing staking: the Staking tab is shown, empty.
const NO_STAKES: StakingState = {
  directory: { loading: true },
  positions: { complete: true, rows: [] },
  selected: null,
  sort: "stake",
  validator: { loading: true },
};

// The staking state passed to the dashboard, carrying the open Home tab.
const stakingFor = (options: DashboardOptions): StakingState | undefined =>
  options.homeTab === undefined
    ? options.staking
    : { ...(options.staking ?? NO_STAKES), homeTab: options.homeTab };

export type DashboardOptions = {
  readonly activity?: readonly ActivityEntry[];
  readonly allowances?: readonly AllowanceView[];
  readonly allowanceNotices?: readonly AllowanceNotice[];
  readonly allowancesUnavailable?: boolean;
  readonly balanceState?: BalanceState;
  readonly changes?: Readonly<Record<string, number>>;
  readonly chart?: readonly number[];
  readonly classHashVerification?: ClassHashVerification | null;
  readonly connectedSites?: readonly ConnectedSite[];
  readonly deployment?: boolean | null;
  readonly discoveredNfts?: readonly DiscoveredNft[];
  readonly addFolderOpen?: boolean;
  readonly collapsedFolders?: readonly string[];
  readonly expandedGroupId?: string | null;
  readonly historyUnavailable?: boolean;
  /**
   * The open Home portfolio tab, kept where production keeps it: in the
   * staking state (`StakingState.homeTab`). Tokens unless a checkpoint opens
   * another.
   */
  readonly homeTab?: "nfts" | "staking" | "tokens";
  readonly multisigClassDeclared?: boolean | "error" | null;
  readonly multisigIntents?: readonly ArgentMultisigSigningIntent[];
  readonly multisigs?: readonly ArgentMultisigView[];
  readonly multisigsError?: boolean;
  /** How complete the NFT indexer said its list was. */
  readonly nftCoverage?: "complete" | "incomplete" | "none" | "unavailable";
  readonly pending?: readonly PendingApproval[];
  readonly preferences?: WalletPreferences | null;
  readonly priceAsOf?: number | null;
  readonly priceStale?: boolean;
  readonly prices?: Readonly<Record<string, number>>;
  readonly privacy?: PrivacyDisclosureState;
  readonly privacyJourney?: PrivacyJourneyState;
  readonly selectedMultisigId?: string | null;
  readonly selectedMultisigIntentId?: string | null;
  readonly selectedNftId?: string | null;
  readonly selectedTokenId?: string | null;
  /** The Home signability verdict; absent renders a normal, signable account. */
  readonly signability?: SignabilityVerdict | null;
  readonly snoozed?: readonly string[];
  readonly staking?: StakingState;
  readonly status?: WalletStatus;
  readonly view?: WalletView;
};

// The allowance manager's listing for a scenario: fixture rows plus whatever
// the scenario says the background could not vouch for.
const allowanceListing = (options: DashboardOptions): AllowanceListing => ({
  entries: options.allowances ?? [],
  notices: options.allowanceNotices ?? [],
  unavailable: options.allowancesUnavailable ?? false,
});

/**
 * Named-options adapter around the production dashboard's positional render
 * boundary. Scenario modules use this one adapter so new production arguments
 * cannot silently drift into different fixture meanings.
 */
export const walletDashboard = (options: DashboardOptions = {}): string => {
  const { selectedMultisigIntentId = null } = options;
  const status = options.status ?? statusFor();
  const account = status.accounts.find((entry) => entry.id === status.activeAccountId) ?? null;
  const privacy = options.privacy ?? {
    error: null,
    loading: false,
    value: account
      ? {
          accountId: account.id,
          balances: [],
          networkId: status.networkId,
          poolFeeFri: "0",
          registration: "unregistered" as const,
          relayConfigured: false,
        }
      : null,
  };
  return dashboard(
    options.view ?? "home",
    status,
    options.pending ?? [],
    options.preferences === undefined ? preferences : options.preferences,
    options.balanceState ?? { balances },
    options.deployment === undefined ? true : options.deployment,
    options.activity ?? softwareActivity,
    options.connectedSites ?? [],
    options.prices ?? { [USDC_ADDRESS]: 1 },
    options.chart ?? [],
    options.selectedTokenId ?? null,
    allowanceListing(options),
    options.selectedNftId ?? null,
    options.changes ?? {},
    options.multisigs ?? [],
    options.multisigIntents ?? [],
    options.selectedMultisigId ?? null,
    options.multisigClassDeclared ?? null,
    options.collapsedFolders,
    options.expandedGroupId ?? null,
    options.priceStale ?? false,
    options.priceAsOf ?? null,
    options.discoveredNfts ?? [discoveredNft],
    options.addFolderOpen ?? false,
    options.classHashVerification ?? null,
    options.historyUnavailable ?? false,
    options.snoozed ?? [],
    options.multisigsError ?? false,
    options.balanceState ?? { balances },
    options.selectedMultisigId ?? null,
    privacy,
    options.privacyJourney ?? { stage: "idle" },
    null,
    selectedMultisigIntentId,
    null,
    options.signability ?? null,
    [],
    false,
    stakingFor(options),
    options.nftCoverage ?? "none",
  );
};
