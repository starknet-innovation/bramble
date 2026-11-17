/**
 * The time span a co-signer sync scans, and how long one wrap may hold it
 * open. A wrap that can never become valid is receipted; one that can still
 * clear holds the window back, but never beyond the first-sync lookback, so a
 * sender cannot pin the scan with wraps that are retried forever.
 */

const NOSTR_SYNC_LOOKBACK_SECONDS = 30 * 24 * 60 * 60;
const NOSTR_INCREMENTAL_LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

/** Where the next sync may start: now, or just before the oldest retryable wrap. */
export const retryableSyncedAt = (nowSeconds: number, oldestRetryableAt: number | null): number =>
  oldestRetryableAt === null
    ? nowSeconds
    : Math.min(nowSeconds, oldestRetryableAt + NOSTR_INCREMENTAL_LOOKBACK_SECONDS);

/** The `since` bound for a relay query, from the last recorded sync. */
export const nostrSyncSince = (nowSeconds: number, syncedAt: number | undefined): number =>
  Math.max(
    0,
    syncedAt !== undefined && syncedAt <= nowSeconds
      ? syncedAt - NOSTR_INCREMENTAL_LOOKBACK_SECONDS
      : nowSeconds - NOSTR_SYNC_LOOKBACK_SECONDS,
  );

/**
 * True when a wrap that is still retryable has aged past the first-sync
 * lookback. It is then receipted as final instead of holding the scan back.
 */
export const isWrapPastRetry = (createdAt: number, nowSeconds: number): boolean =>
  createdAt < nowSeconds - NOSTR_SYNC_LOOKBACK_SECONDS;
