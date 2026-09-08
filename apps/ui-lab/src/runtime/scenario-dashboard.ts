import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import type { ActivityEntry } from "@bramble/transactions/activity";
import type { AllowanceView } from "@bramble/transactions/allowance-discovery";
import type {
  ArgentMultisigView,
  BalanceState,
  ConnectedSite,
  DiscoveredNft,
  PendingApproval,
  PrivacyDisclosureState,
  PrivacyJourneyState,
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

export type DashboardOptions = {
  readonly activity?: readonly ActivityEntry[];
  readonly allowances?: readonly AllowanceView[];
  readonly balanceState?: BalanceState;
  readonly changes?: Readonly<Record<string, number>>;
  readonly chart?: readonly number[];
  readonly classHashVerification?: ClassHashVerification | null;
  readonly connectedSites?: readonly ConnectedSite[];
  readonly deployment?: boolean | null;
  readonly discoveredNfts?: readonly DiscoveredNft[];
  readonly expandedGroupId?: string | null;
  readonly historyUnavailable?: boolean;
  readonly multisigClassDeclared?: boolean | "error" | null;
  readonly multisigIntents?: readonly ArgentMultisigSigningIntent[];
  readonly multisigs?: readonly ArgentMultisigView[];
  readonly multisigsError?: boolean;
  readonly openAssignId?: string | null;
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
  readonly snoozed?: readonly string[];
  readonly status?: WalletStatus;
  readonly view?: WalletView;
};

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
    options.allowances ?? [],
    options.selectedNftId ?? null,
    options.changes ?? {},
    options.multisigs ?? [],
    options.multisigIntents ?? [],
    options.selectedMultisigId ?? null,
    options.multisigClassDeclared ?? null,
    null,
    options.expandedGroupId ?? null,
    options.priceStale ?? false,
    options.priceAsOf ?? null,
    options.discoveredNfts ?? [discoveredNft],
    options.openAssignId ?? null,
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
  );
};
