/**
 * A side-panel stand-in for the QSB journey tests: navigation
 * paints the view's real production markup and binds it, as the panel's paint
 * loop does; Back pops to the screen before. Timers are manual, so a test
 * decides when the account screen's poll fires; the document's visibility and
 * the browser's coordinator grant are scriptable.
 */
import { EMPTY_ALLOWANCE_LISTING } from "../../src/popup/responses/responses";
import { simpleFlowScreen } from "../../src/sidepanel/app/screens/flows";
import type { WalletView } from "../../src/sidepanel/app/screens/views";
import { createQsbJourney } from "../../src/sidepanel/journeys/qsb/qsb-journey";
import type { HostPermissionApi } from "../../src/sidepanel/runtime/runtime-global";
import { type ManualTimers, manualTimers } from "./manual-timers";
import { mountApp, type QsbScript, qsbStatus, scriptedQsbWallet } from "./qsb-harness";

/** The production markup of a QSB flow `view`. */
export const qsbScreen = (view: WalletView): string => {
  const markup = simpleFlowScreen(view, {
    account: null,
    allowances: EMPTY_ALLOWANCE_LISTING,
    balances: [],
    changes: {},
    classHashVerification: null,
    connectedSites: [],
    currency: "usd",
    deployment: null,
    expandedGroupId: null,
    preferences: null,
    prices: {},
    privacy: { error: null, loading: false, value: null },
    status: qsbStatus,
  });
  if (markup === null) throw new Error(`${view} has no flow screen`);
  return markup;
};

/** Makes `document.visibilityState` read `state` and tells listeners, as a tab switch does. */
export const setVisibility = (state: "hidden" | "visible"): void => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

/**
 * A browser permission API for the coordinator grant: `granted` is what
 * `contains` answers and `answer` what the prompt does (a yes also grants).
 * Records every origin list checked and asked for, in order.
 */
export const scriptedPermissions = (initial: { answer?: boolean; granted?: boolean } = {}) => {
  const state = { answer: initial.answer ?? true, granted: initial.granted ?? true };
  const checked: string[][] = [];
  const asked: string[][] = [];
  const api: HostPermissionApi = {
    contains: async ({ origins }) => {
      checked.push([...origins]);
      return state.granted;
    },
    request: async ({ origins }) => {
      asked.push([...origins]);
      if (state.answer) state.granted = true;
      return state.answer;
    },
  };
  return { api, asked, checked, state };
};

/**
 * The journey over a scripted client, with every navigation painted and bound.
 * Back pops to the screen before; `timers` drives the poll; `script` is the
 * live script, which a test may change between reads.
 */
export const qsbPanel = (
  script: QsbScript,
  permissions: ReturnType<typeof scriptedPermissions> = scriptedPermissions(),
) => {
  const { calls, wallet } = scriptedQsbWallet(script);
  const timers: ManualTimers = manualTimers();
  const visited: WalletView[] = [];
  const history: WalletView[] = [];
  let app: HTMLElement | null = null;
  let current: WalletView | null = null;
  const paint = (view: WalletView): HTMLElement => {
    current = view;
    app = mountApp(qsbScreen(view));
    journey.bind(app);
    return app;
  };
  const journey = createQsbJourney({
    back: () => {
      const previous = history.pop();
      if (previous) paint(previous);
    },
    navigate: (view) => {
      visited.push(view);
      if (current !== null && current !== view) history.push(current);
      paint(view);
    },
    now: () => 0,
    permissions: permissions.api,
    timers,
    wallet,
  });
  return {
    app: (): HTMLElement => {
      if (!app) throw new Error("nothing painted");
      return app;
    },
    calls,
    journey,
    paint,
    permissions,
    script,
    timers,
    visited,
  };
};
