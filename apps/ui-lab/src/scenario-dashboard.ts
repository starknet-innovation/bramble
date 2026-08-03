import type { MultisigClassState } from "../../../src/popup/multisig-responses";
import type {
  ConnectedSite,
  DiscoveredNft,
  PendingApproval,
  WalletStatus,
} from "../../../src/popup/responses";
import type { BalanceState } from "../../../src/sidepanel/runtime";
import type { MultisigSyncState } from "../../../src/sidepanel/multisig-sync";
import { dashboard, type WalletView } from "../../../src/sidepanel/views";
import type { AllowanceView } from "../../../src/starknet/allowance-discovery";
import type { ClassHashVerification } from "../../../src/starknet/class-hash-verify";
import type { ActivityEntry } from "../../../src/storage/activity-store";
import type { MultisigProposalRecord, MultisigRecord } from "../../../src/storage/multisig-store";
import type { WalletPreferences } from "../../../src/storage/preferences-store";
import {
  balances,
  discoveredNft,
  preferences,
  softwareActivity,
  statusFor,
  USDC_ADDRESS,
} from "./fixtures";

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
  readonly multisigClassDeclared?: MultisigClassState | "error" | null;
  readonly multisigProposals?: readonly MultisigProposalRecord[];
  readonly multisigSync?: MultisigSyncState;
  readonly multisigNfts?: readonly DiscoveredNft[];
  readonly multisigs?: readonly MultisigRecord[];
  readonly multisigsError?: boolean;
  readonly openAssignId?: string | null;
  readonly pending?: readonly PendingApproval[];
  readonly preferences?: WalletPreferences | null;
  readonly priceAsOf?: number | null;
  readonly priceStale?: boolean;
  readonly prices?: Readonly<Record<string, number>>;
  readonly selectedMultisigId?: string | null;
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
export const walletDashboard = (options: DashboardOptions = {}): string =>
  dashboard(
    options.view ?? "home",
    options.status ?? statusFor(),
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
    options.multisigProposals ?? [],
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
    options.multisigSync ?? null,
    options.balanceState ?? { balances },
    options.selectedMultisigId ?? null,
    options.multisigNfts ?? [],
    options.selectedMultisigId ?? null,
  );
