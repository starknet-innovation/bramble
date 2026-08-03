/**
 * Background cadence for transaction reconciliation.
 *
 * The side panel polls hard for the first few seconds after a send, but it is
 * the only thing that did: with the panel closed nothing advanced a
 * pre-confirmed transaction, and nothing ever re-checked an accepted one. This
 * module gives reconciliation its own schedule in the service worker.
 *
 * `chrome.alarms` is used rather than `setInterval`: an MV3 service worker is
 * terminated when idle, so a timer beyond ~30s is not a schedule, it is a
 * coin flip. Alarms survive worker termination and wake it back up. Two alarms
 * carry the two cadences from `./tx-observation.ts` — a one-minute tick for
 * transactions that are still unresolved, and a quarter-hour tick for accepted
 * transactions waiting on L1 proof — so nothing hot-polls for hours.
 *
 * The clock is injected; this module reads no ambient time.
 */

import {
  FAST_OBSERVATION_PERIOD_MINUTES,
  type ObservationTier,
  SLOW_OBSERVATION_PERIOD_MINUTES,
} from "./tx-observation";
import type { ReconcileDeps } from "./tx-reconcile";
import { reconcileObserved } from "./tx-reconcile";

/**
 * Alarm names, one per cadence. Namespaced so they cannot collide with any
 * other alarm the extension may grow later.
 */
const ALARM_TIERS: Readonly<Record<string, ObservationTier>> = {
  "mc-wallet:tx-observe-fast": "fast",
  "mc-wallet:tx-observe-slow": "slow",
};

const PERIOD_MINUTES: Readonly<Record<ObservationTier, number>> = {
  fast: FAST_OBSERVATION_PERIOD_MINUTES,
  slow: SLOW_OBSERVATION_PERIOD_MINUTES,
};

/**
 * The slice of `chrome.alarms` this module uses. Declared structurally so the
 * worker can pass the real API and tests can pass a double, and optional
 * throughout so a runtime without the alarms permission degrades to "the side
 * panel reconciles when it is open" instead of throwing.
 */
export type AlarmsApi = {
  readonly create: (name: string, info: { readonly periodInMinutes: number }) => void;
  readonly get: (name: string) => Promise<{ readonly name: string } | undefined>;
  readonly onAlarm: {
    readonly addListener: (listener: (alarm: { readonly name: string }) => void) => void;
  };
};

// Creates an alarm only when it is missing. `alarms.create` on a name that
// already exists REPLACES that alarm and restarts its period, and this module
// re-runs on every worker wake — a dapp message, a side-panel poll, any of
// which can arrive more often than once a minute. Re-creating unconditionally
// would therefore keep pushing the fast alarm's deadline forward and it would
// never fire, which is precisely the case this schedule exists to cover.
const ensureAlarm = async (
  alarms: AlarmsApi,
  name: string,
  tier: ObservationTier,
): Promise<void> => {
  if ((await alarms.get(name)) === undefined) {
    alarms.create(name, { periodInMinutes: PERIOD_MINUTES[tier] });
  }
};

/**
 * Browser surface the monitor is wired to.
 */
export type TxMonitorBrowser = {
  readonly alarms?: AlarmsApi;
};

/**
 * Starts background reconciliation.
 *
 * Registers the listener that services the cadence alarms, and creates any
 * alarm that does not already exist — existing ones are left alone so their
 * schedule survives a worker restart. Returns false when the runtime exposes no
 * alarms API, so the caller can tell "not scheduled" from "scheduled";
 * reconciliation still runs on every activity request in that case. Individual
 * runs never reject: a failed poll leaves the transaction under observation for
 * the next tick.
 */
export const startTransactionMonitor = ({
  browser,
  deps,
  now,
}: {
  readonly browser: TxMonitorBrowser | undefined;
  readonly deps: ReconcileDeps;
  readonly now: () => number;
}): boolean => {
  const alarms = browser?.alarms;
  if (!alarms) {
    return false;
  }
  for (const [name, tier] of Object.entries(ALARM_TIERS)) {
    void ensureAlarm(alarms, name, tier).catch(() => undefined);
  }
  alarms.onAlarm.addListener((alarm) => {
    const tier = ALARM_TIERS[alarm.name];
    if (tier) {
      void reconcileObserved(deps, tier, now()).catch(() => undefined);
    }
  });
  return true;
};
