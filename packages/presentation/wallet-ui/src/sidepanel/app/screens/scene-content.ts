/**
 * Chooses the side-panel markup for one paint: the full-page onboarding
 * surfaces, the lock screen, or the unlocked dashboard. It is a pure projection
 * of the render cache plus the paint loop's navigation state — it reads no
 * storage, holds no secrets, and every dynamic value is escaped by the views it
 * delegates to.
 */
import { locked, onboarding } from "../../journeys/onboarding/gate-views";
import { onboardingComplete, onboardingLaunch } from "../../journeys/onboarding/onboarding-surface";
import type {
  PrivacyDisclosureState,
  PrivacyJourneyState,
} from "../../journeys/privacy/privacy-model";
import type { SendIntent } from "../../journeys/send/send-model";
import { type RenderData, verificationForAccount } from "../rendering/render-cache";
import { dashboard, type WalletView } from "./views";

/** The paint loop's navigation and UI state that the scene markup depends on. */
export type SceneContentState = {
  readonly activeView: WalletView;
  readonly addFolderOpen: boolean;
  readonly collapsedFolders: readonly string[];
  readonly expandedGroupId: string | null;
  readonly fullPageOnboarding: boolean;
  readonly ledgerAvailable: boolean;
  readonly privacy: PrivacyDisclosureState;
  readonly privacyJourney: PrivacyJourneyState;
  readonly selectedMultisigId: string | null;
  readonly selectedMultisigIntentId: string | null;
  readonly selectedNftId: string | null;
  readonly selectedTokenId: string | null;
  readonly sendIntent: SendIntent | null;
  readonly snoozedApprovalIds: readonly string[];
  readonly todayKey: number | null;
};

/**
 * Renders the markup for the current scene. A full-page onboarding tab with a
 * vault shows the completion card; no vault shows onboarding (or its launcher in
 * the side panel); a locked vault shows the lock screen; otherwise the dashboard.
 * Class-hash verification is shown only when it belongs to the active account.
 */
export const sceneContent = (cache: RenderData, state: SceneContentState): string => {
  const { status } = cache;
  if (state.fullPageOnboarding && status.hasVault) return onboardingComplete();
  if (!status.hasVault) {
    return state.fullPageOnboarding
      ? onboarding(status, state.ledgerAvailable)
      : onboardingLaunch();
  }
  if (status.locked) return locked(status, cache.pending);
  return dashboard(
    state.activeView,
    status,
    cache.pending,
    cache.preferences,
    cache.balances,
    cache.deployment,
    cache.transactions,
    cache.connectedSites,
    cache.prices,
    cache.chartTokenId === state.selectedTokenId ? cache.chart : [],
    state.selectedTokenId,
    cache.allowances,
    state.selectedNftId,
    cache.changes,
    cache.multisigs.multisigs,
    cache.multisigs.intents,
    state.selectedMultisigId,
    cache.multisigClassDeclared,
    state.collapsedFolders,
    state.expandedGroupId,
    cache.priceStale,
    cache.priceAsOf,
    [],
    state.addFolderOpen,
    verificationForAccount(cache.classHashVerification, status.activeAccountId),
    cache.historyUnavailable,
    state.snoozedApprovalIds,
    cache.multisigsError,
    cache.multisigBalances,
    cache.multisigBalanceId,
    state.privacy,
    state.privacyJourney,
    state.sendIntent,
    state.selectedMultisigIntentId,
    state.todayKey,
    cache.signability,
  );
};
