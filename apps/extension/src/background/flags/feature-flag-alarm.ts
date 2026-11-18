/**
 * `chrome.alarms` boundary for feature-flag refresh.
 *
 * One periodic alarm drives a forced refresh every
 * {@link FEATURE_FLAG_REFRESH_MINUTES}; each worker start also asks for a
 * refresh, which the client skips when the last check is recent. The alarm is
 * only created when missing, because re-creating it on every worker wake would
 * restart its period and starve it (see `../transactions/tx-monitor`).
 */
import type { AlarmsApi } from "../transactions/tx-monitor";
import type { FeatureFlagClient } from "./feature-flag-client";

/** Alarm name for the periodic refresh. */
export const FEATURE_FLAG_ALARM = "bramble:feature-flags";

/** Refresh cadence in minutes. */
const FEATURE_FLAG_REFRESH_MINUTES = 30;

/**
 * Wires the periodic refresh and the startup refresh. The listener is attached
 * synchronously so a wake caused by the alarm itself is serviced. `ready`
 * gates network work on storage lockdown. Never throws; a missing alarms API
 * leaves only the startup refresh.
 */
export const startFeatureFlagRefresh = ({
  alarms,
  client,
  ready,
}: {
  readonly alarms: AlarmsApi | undefined;
  readonly client: Pick<FeatureFlagClient, "refresh">;
  readonly ready: Promise<void>;
}): void => {
  const refresh = (force: boolean): void => {
    void ready.then(() => client.refresh({ force })).catch(() => undefined);
  };
  if (alarms) {
    try {
      alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === FEATURE_FLAG_ALARM) {
          refresh(true);
        }
      });
      // `create` returns a promise on MV3 Chrome: it is returned into the
      // chain so a rejection lands in the catch instead of going unhandled.
      void alarms
        .get(FEATURE_FLAG_ALARM)
        .then((existing) =>
          existing === undefined
            ? alarms.create(FEATURE_FLAG_ALARM, { periodInMinutes: FEATURE_FLAG_REFRESH_MINUTES })
            : undefined,
        )
        .catch(() => undefined);
    } catch {
      // A context-invalidated runtime can throw synchronously; startup refresh still runs.
    }
  }
  refresh(false);
};
