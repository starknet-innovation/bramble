/**
 * `chrome.alarms` boundary for the live phishing feed's refresh cadence.
 *
 * The feed refetches when its cache is older than its TTL, but only when
 * something asks it to. Asking once per worker start tied the cadence to how
 * often the MV3 worker happened to restart, so a long-lived worker could serve
 * a list of any age (Sherlock 182). A recurring alarm wakes the worker on a
 * fixed period instead; the feed's own TTL still decides whether a wake
 * fetches anything.
 */

/** Alarm name for the recurring phishing-feed refresh. */
export const PHISHING_FEED_ALARM = "bramble:phishing-feed";

/**
 * How often the refresh runs, in minutes. Shorter than the feed's 6-hour TTL
 * so a lapsed list is retried within the hour, and long enough that a wake
 * that finds the cache fresh costs one storage read.
 */
export const PHISHING_FEED_PERIOD_MINUTES = 60;

/**
 * The slice of `chrome.alarms` this module uses. Declared structurally so the
 * worker passes the real API and tests pass a double.
 */
export type PhishingFeedAlarmsApi = {
  readonly create: (name: string, info: { readonly periodInMinutes: number }) => void;
  readonly onAlarm: {
    readonly addListener: (listener: (alarm: { readonly name: string }) => void) => void;
  };
};

/**
 * Runs `refresh` now and on every {@link PHISHING_FEED_ALARM}. Returns whether
 * the recurring alarm was armed; without an alarms API, or when the runtime
 * refuses it, the feed keeps its refresh-on-start behaviour. Refresh failures
 * never propagate: the feed already falls back to its cached list and the
 * bundled baseline.
 */
export const schedulePhishingFeedRefresh = (
  alarms: PhishingFeedAlarmsApi | undefined,
  refresh: () => Promise<unknown>,
): boolean => {
  const run = (): void => {
    void refresh().catch(() => undefined);
  };
  run();
  if (!alarms) {
    return false;
  }
  try {
    alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === PHISHING_FEED_ALARM) {
        run();
      }
    });
    // Creating the alarm again replaces it, so every worker start re-arms the
    // same single cadence rather than stacking alarms.
    alarms.create(PHISHING_FEED_ALARM, { periodInMinutes: PHISHING_FEED_PERIOD_MINUTES });
    return true;
  } catch {
    return false;
  }
};
