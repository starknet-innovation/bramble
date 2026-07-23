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
import { hasOnlyKnownKeys, isRecord } from "../shared/json";
import { systemClock } from "../storage/activity-store";
import type { KeyValueStore } from "../storage/kv";

/**
 * Browser-storage key for the cached phishing feed. Plain (non-secret) data.
 */
export const PHISHING_FEED_STORE_KEY = "mc-wallet:phishing-feed";
const PHISHING_CACHE_VERSION = 1;

/**
 * Default maintained source: MetaMask's eth-phishing-detect config, the
 * de-facto web3 phishing list. Configurable per deployment via the `source`
 * option; the background must declare a matching host permission.
 */
export const DEFAULT_PHISHING_FEED_URL =
  "https://metamask.github.io/eth-phishing-detect/v1/config.json";

// Refresh cadence: refetch only when the cache is older than this. The MV3
// worker warms the feed on startup, so in practice the list refreshes on the
// first wake after the TTL lapses.
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
// Bounds the in-memory set and persisted cache so a hostile or oversized feed
// cannot exhaust storage; well above the size of current public web3 lists.
const MAX_DOMAINS = 100_000;
const HOST_PATTERN = /^[a-z0-9.-]+$/;

/**
 * Minimal HTTP response subset consumed from the injected fetch.
 */
export type PhishingFeedResponse = {
  readonly json: () => Promise<unknown>;
  readonly ok: boolean;
};

/**
 * Injectable network fetch used only by the background worker.
 */
export type PhishingFeedFetch = (url: string) => Promise<PhishingFeedResponse>;

/**
 * The live feed: a synchronous snapshot accessor for enforcement plus an async
 * refresh the background drives on a cadence.
 */
export type PhishingFeed = {
  readonly blockedDomains: () => ReadonlySet<string>;
  readonly refresh: () => Promise<ReadonlySet<string>>;
};

type PhishingCache = {
  readonly domains: readonly string[];
  readonly fetchedAt: number;
  readonly schemaVersion: typeof PHISHING_CACHE_VERSION;
  readonly source: string;
};

const normalizeDomain = (value: string): string | null => {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  return domain.includes(".") && HOST_PATTERN.test(domain) ? domain : null;
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
  if (!Array.isArray(raw)) {
    return null;
  }
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const domain = normalizeDomain(entry);
    if (domain === null || seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    domains.push(domain);
    if (domains.length >= MAX_DOMAINS) {
      break;
    }
  }
  return domains;
};

const readPhishingCache = (
  value: unknown,
  expectedSource: string,
  currentTime: number,
): PhishingCache | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["domains", "fetchedAt", "schemaVersion", "source"]) ||
    !Array.isArray(value["domains"]) ||
    value["domains"].length > MAX_DOMAINS ||
    typeof value["fetchedAt"] !== "number" ||
    !Number.isFinite(value["fetchedAt"]) ||
    value["fetchedAt"] < 0 ||
    value["fetchedAt"] > currentTime ||
    value["schemaVersion"] !== PHISHING_CACHE_VERSION ||
    value["source"] !== expectedSource
  ) {
    return null;
  }
  const domains: string[] = [];
  const seen = new Set<string>();
  for (const entry of value["domains"]) {
    if (typeof entry !== "string") {
      return null;
    }
    const domain = normalizeDomain(entry);
    if (domain === null || seen.has(domain)) {
      return null;
    }
    seen.add(domain);
    domains.push(domain);
  }
  return {
    domains,
    fetchedAt: value["fetchedAt"],
    schemaVersion: PHISHING_CACHE_VERSION,
    source: expectedSource,
  };
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

  const setSnapshot = (domains: readonly string[]): ReadonlySet<string> => {
    snapshot = new Set(domains);
    return snapshot;
  };

  const readCache = async (currentTime: number): Promise<PhishingCache | null> => {
    const stored = await store.get(PHISHING_FEED_STORE_KEY).catch(() => undefined);
    return readPhishingCache(stored, source, currentTime);
  };

  const fetchDomains = async (): Promise<readonly string[] | null> => {
    try {
      const response = await fetch(source);
      if (!response.ok) {
        return null;
      }
      return parsePhishingFeed(await response.json());
    } catch {
      return null;
    }
  };

  return {
    blockedDomains: () => snapshot,
    async refresh() {
      const currentTime = now();
      const cache = await readCache(currentTime);
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
      await store
        .set(PHISHING_FEED_STORE_KEY, {
          domains: fetched,
          fetchedAt: now(),
          schemaVersion: PHISHING_CACHE_VERSION,
          source,
        })
        .catch(() => undefined);
      return setSnapshot(fetched);
    },
  };
};
