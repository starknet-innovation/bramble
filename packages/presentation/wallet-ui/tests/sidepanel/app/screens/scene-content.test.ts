/**
 * sceneContent picks the paint's markup from the render cache: the full-page
 * onboarding surfaces, the lock screen, or the dashboard — and hands the
 * dashboard every cached field in its positional slot.
 */
import { describe, expect, test } from "bun:test";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import {
  type SceneContentState,
  sceneContent,
} from "../../../../src/sidepanel/app/screens/scene-content";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import { locked, onboarding } from "../../../../src/sidepanel/journeys/onboarding/gate-views";
import {
  onboardingComplete,
  onboardingLaunch,
} from "../../../../src/sidepanel/journeys/onboarding/onboarding-surface";

const unlocked: WalletStatus = {
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const state: SceneContentState = {
  activeView: "home",
  addFolderOpen: false,
  collapsedFolders: [],
  expandedGroupId: null,
  fullPageOnboarding: false,
  ledgerAvailable: true,
  privacy: { error: null, loading: false, value: null },
  privacyJourney: { stage: "idle" },
  selectedMultisigId: null,
  selectedMultisigIntentId: null,
  selectedNftId: null,
  selectedTokenId: null,
  sendIntent: null,
  snoozedApprovalIds: [],
  todayKey: null,
};

const cacheWith = (status: WalletStatus) => ({ ...emptyRenderCache(), preferences, status });

describe("sceneContent", () => {
  test("chooses the onboarding surfaces by vault and surface", () => {
    const noVault = { ...unlocked, hasVault: false };
    expect(sceneContent(cacheWith(noVault), state)).toBe(onboardingLaunch());
    expect(
      sceneContent(cacheWith(noVault), {
        ...state,
        fullPageOnboarding: true,
        ledgerAvailable: false,
      }),
    ).toBe(onboarding(noVault, false));
    expect(sceneContent(cacheWith(unlocked), { ...state, fullPageOnboarding: true })).toBe(
      onboardingComplete(),
    );
  });

  test("shows the lock screen for a locked vault", () => {
    const lockedStatus = { ...unlocked, locked: true };
    expect(sceneContent(cacheWith(lockedStatus), state)).toBe(locked(lockedStatus, []));
  });

  test("renders the dashboard from the cache, keeping verification to its own account", () => {
    const unreachable = { status: "unreachable" } as const;
    const view = { ...state, activeView: "receive" as const, todayKey: 20_000 };
    const render = (verifiedAccountId: string) => {
      const cache = {
        ...cacheWith(unlocked),
        classHashVerification: {
          accountId: verifiedAccountId,
          ok: true as const,
          verification: unreachable,
        },
        priceStale: true,
      };
      const expected = (verification: typeof unreachable | null) =>
        dashboard(
          "receive",
          unlocked,
          [],
          preferences,
          cache.balances,
          cache.deployment,
          cache.transactions,
          cache.connectedSites,
          cache.prices,
          cache.chart,
          null,
          cache.allowances,
          null,
          cache.changes,
          cache.multisigs.multisigs,
          cache.multisigs.intents,
          null,
          cache.multisigClassDeclared,
          [],
          null,
          true,
          cache.priceAsOf,
          [],
          false,
          verification,
          cache.historyUnavailable,
          [],
          cache.multisigsError,
          cache.multisigBalances,
          cache.multisigBalanceId,
          state.privacy,
          state.privacyJourney,
          null,
          null,
          20_000,
          cache.signability,
        );
      return { actual: sceneContent(cache, view), expected };
    };
    const own = render(account.id);
    expect(own.actual).toBe(own.expected(unreachable));
    const foreign = render(secondAccount.id);
    expect(foreign.actual).toBe(foreign.expected(null));
    // The receive screen shows the badge, so the two answers really differ.
    expect(own.actual).not.toBe(foreign.actual);
  });
});
