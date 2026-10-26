/**
 * Live phishing blocklist feed (issue #34). Fetches a maintained list of
 * malicious registrable domains from a configurable source, validates the
 * payload, and caches it in a plain (non-secret) local store. The list is
 * refreshed on a TTL cadence and always degrades safely: an unreachable or
 * malformed source falls back to the last good cache, and — because the bundled
 * baseline list in `blocklist.ts` is consulted independently — protection never
 * drops below the shipped baseline (fail-safe, not fail-open).
 *
 * Network, storage, and clock are injected so this module stays pure at its
 * edges and unit-testable without a real network; the background worker wires
 * the real `fetch` and the local storage adapter. It only ever holds and exposes a
 * set of exact-match domains — the wallet's own heuristics cover fuzzy /
 * lookalike detection — so the payload we consume is deliberately narrow.
 *
 * Wire format (JSON): `{ "blocklist": string[], "version"?: number }`. Entries
 * are registrable domains ("evil.com"); a match blocks the domain and all its
 * subdomains. For drop-in compatibility with the de-facto web3 phishing list
 * (MetaMask's eth-phishing-detect), a `blacklist` key is accepted as an alias
 * and any additional fields (fuzzylist, whitelist, tolerance) are ignored.
 */
import {
  type BoundedHttpFetch,
  type BoundedHttpResponse,
  fetchBoundedJson,
  HTTP_BODY_LIMITS,
} from "@bramble/core/http-json";
import { isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import {
  MAX_PHISHING_DOMAIN_CHARS,
  MAX_PHISHING_DOMAINS,
  normalizePhishingDomain,
  phishingDomainChars,
  readPhishingCache,
  writePhishingCache,
} from "./phishing-feed-cache";

export { PHISHING_FEED_STORE_KEY } from "./phishing-feed-cache";

// Clock boundary for this module: the feed's TTL is the only time it reads, and
// callers may inject their own clock. Kept local so the phishing feed does not
// depend on an unrelated feature package for a one-line reader.
const systemClock = (): number => Date.now();

/**
 * Default maintained source: MetaMask's eth-phishing-detect config, the
 * de-facto web3 phishing list, read from the repository's `src/config.json`.
 * The old GitHub Pages copy (`metamask.github.io/.../v1/config.json`) returns
 * 404, so the live list never loaded (issue 772). It is served as `text/plain`;
 * the bounded fetch doesn't check the content type, and it rejects redirects.
 * Configurable per deployment via the `source` option; the background must
 * declare a matching host permission.
 */
export const DEFAULT_PHISHING_FEED_URL =
  "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";

// Refresh cadence: refetch only when the cache is older than this. The MV3
// worker warms the feed on startup, so in practice the list refreshes on the
// first wake after the TTL lapses.
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Minimal HTTP response subset consumed from the injected fetch: the shared
 * bounded-read shape.
 */
export type PhishingFeedResponse = BoundedHttpResponse;

/**
 * Injectable network fetch used only by the background worker. Production wires
 * the shared `untrustedFetch`, which carries the boundary's request options (no
 * cookies, no referrer, redirects refused) and its deadline signal through to
 * the real `fetch`. Reads go through the shared bounded reader either way, so a
 * source that answers with an endless or never-finished body is cut off rather
 * than buffered into the worker even when a test double ignores the options.
 */
export type PhishingFeedFetch = BoundedHttpFetch;

/**
 * The live feed: a synchronous snapshot accessor for enforcement plus an async
 * refresh the background drives on a cadence. `cacheWriteFailed` reports
 * whether the most recent attempt to persist a fetched list failed (for
 * example on a storage quota error), so the failure is observable rather than
 * silently costing the next worker wake its cached protection.
 */
export type PhishingFeed = {
  readonly blockedDomains: () => ReadonlySet<string>;
  readonly cacheWriteFailed: () => boolean;
  readonly refresh: () => Promise<ReadonlySet<string>>;
};

// Normalizes and de-duplicates entries up to both caps: the count keeps the
// cache inside its chunk budget, the size keeps it from crowding the wallet's
// own storage. Non-string and malformed entries are skipped.
const boundedDomains = (raw: readonly unknown[]): readonly string[] => {
  const seen = new Set<string>();
  const domains: string[] = [];
  let chars = 0;
  for (const entry of raw) {
    const domain = typeof entry === "string" ? normalizePhishingDomain(entry) : null;
    if (domain === null || seen.has(domain)) {
      continue;
    }
    chars += phishingDomainChars(domain);
    if (chars > MAX_PHISHING_DOMAIN_CHARS) {
      break;
    }
    seen.add(domain);
    domains.push(domain);
    if (domains.length >= MAX_PHISHING_DOMAINS) {
      break;
    }
  }
  return domains;
};

/**
 * Parses a feed payload into a de-duplicated, normalized domain list. Returns
 * null when the payload is not the expected shape (missing `blocklist` /
 * `blacklist` array) so the caller treats it as a fetch failure and falls back;
 * a well-formed but empty list parses to `[]` and is accepted.
 */
export const parsePhishingFeed = (body: unknown): readonly string[] | null => {
  if (!isRecord(body)) {
    return null;
  }
  const raw = body["blocklist"] ?? body["blacklist"];
  return Array.isArray(raw) ? boundedDomains(raw) : null;
};

/**
 * Creates the storage-backed phishing feed. On {@link PhishingFeed.refresh} it
 * loads the last cached list into memory, then refetches only when the cache is
 * stale (or absent); a failed or malformed fetch keeps the cached snapshot so
 * the domain set never regresses on a transient outage. The clock and fetch are
 * injected; the background wires the real ones.
 */
export const createPhishingFeed = ({
  fetch,
  now = systemClock,
  source = DEFAULT_PHISHING_FEED_URL,
  store,
  ttlMs = DEFAULT_TTL_MS,
}: {
  readonly fetch: PhishingFeedFetch;
  readonly now?: () => number;
  readonly source?: string;
  readonly store: KeyValueStore;
  readonly ttlMs?: number;
}): PhishingFeed => {
  let snapshot: ReadonlySet<string> = new Set();
  let writeFailed = false;

  const setSnapshot = (domains: readonly string[]): ReadonlySet<string> => {
    snapshot = new Set(domains);
    return snapshot;
  };

  // Never throws: a non-ok status, a transport error, an over-budget body, an
  // exchange that outlives its deadline, or a malformed payload all resolve to
  // null so the caller keeps the cached snapshot instead of regressing.
  const fetchDomains = async (): Promise<readonly string[] | null> => {
    try {
      return parsePhishingFeed(
        await fetchBoundedJson(fetch, source, HTTP_BODY_LIMITS.phishingFeed),
      );
    } catch {
      return null;
    }
  };

  return {
    blockedDomains: () => snapshot,
    cacheWriteFailed: () => writeFailed,
    async refresh() {
      const currentTime = now();
      const cache = await readPhishingCache(store, source, currentTime);
      if (cache) {
        // Promote the last good list into memory before any network work, so a
        // slow or failing fetch still leaves the cached protection in place.
        setSnapshot(cache.domains);
      }
      if (cache && currentTime - cache.fetchedAt < ttlMs) {
        return snapshot;
      }
      const fetched = await fetchDomains();
      if (fetched === null) {
        // Unreachable or malformed: keep the cached snapshot (or the empty set,
        // with the bundled baseline list still enforced by isBlockedOrigin).
        return snapshot;
      }
      // Persisting is best effort for this refresh (the fetched list is live
      // either way) but the failure is recorded, not swallowed.
      try {
        await writePhishingCache(store, { domains: fetched, fetchedAt: now(), source });
        writeFailed = false;
      } catch {
        writeFailed = true;
      }
      return setSnapshot(fetched);
    },
  };
};
