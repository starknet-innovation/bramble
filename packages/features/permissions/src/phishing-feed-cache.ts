/**
 * Persistence for the live phishing feed (audit #184). Every production store
 * write passes the shared provider JSON budget (4,096 array entries, 1 MiB with
 * strings charged at six bytes per code unit), so a public list of tens of
 * thousands of domains can never be written as one array. The cache is
 * therefore split into chunks sized by an estimated byte budget, not a fixed
 * count, so one long entry cannot push a chunk over the limit.
 *
 * Layout: chunk records under `bramble:phishing-feed:chunk:<i>` are written
 * first, then a manifest under {@link PHISHING_FEED_STORE_KEY}. Every chunk
 * carries the manifest's `fetchedAt` as a generation tag, so a torn write that
 * mixes chunks of two generations fails the read. Reads fail closed: a missing,
 * malformed, out-of-order, or foreign-generation chunk yields no cache at all,
 * never a partial list.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";

/**
 * Browser-storage key for the phishing feed cache manifest. Plain (non-secret)
 * data; the domain chunks live under sibling `:chunk:<i>` keys.
 */
export const PHISHING_FEED_STORE_KEY = "bramble:phishing-feed";

/**
 * Cache schema version. Version 1 was a single unchunked record that could
 * never be persisted at real list sizes; it is ignored on read.
 */
export const PHISHING_CACHE_VERSION = 2;

/**
 * Upper bound on domains held in memory and persisted. Kept within the chunked
 * budget below: at the worst-case entry size (a 253-character name) a chunk
 * holds at least ~590 domains, so this cap needs at most ~170 chunks, under
 * {@link MAX_CHUNKS}.
 */
export const MAX_PHISHING_DOMAINS = 100_000;

// RFC 1035 bound on a DNS name. Also bounds the per-entry storage cost so the
// byte-budgeted chunking below can always place an entry.
const MAX_DOMAIN_LENGTH = 253;
const HOST_PATTERN = /^[a-z0-9.-]+$/;
// Under the provider budget's 4,096-entry array cap and 1 MiB byte cap, with
// headroom for the chunk record's own keys and numbers.
const MAX_CHUNK_ENTRIES = 4_000;
const MAX_CHUNK_BYTES = 900 * 1024;
const MAX_CHUNKS = 256;
// The JSON budget charges 32 bytes per node plus 2 + 6 bytes per character.
const entryCost = (domain: string): number => 34 + domain.length * 6;

const chunkKey = (index: number): string => `${PHISHING_FEED_STORE_KEY}:chunk:${index}`;

/**
 * A validated phishing cache: the domain list, when it was fetched, and the
 * source it was fetched from.
 */
export type PhishingCache = {
  readonly domains: readonly string[];
  readonly fetchedAt: number;
  readonly source: string;
};

/**
 * Normalizes one feed entry to a lowercase registrable host, or null when it is
 * not a dotted host of at most 253 characters. Shared by the feed parser and
 * the cache reader so both accept exactly the same grammar.
 */
export const normalizePhishingDomain = (value: string): string | null => {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  return domain.length <= MAX_DOMAIN_LENGTH && domain.includes(".") && HOST_PATTERN.test(domain)
    ? domain
    : null;
};

const splitIntoChunks = (domains: readonly string[]): readonly (readonly string[])[] => {
  const chunks: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const domain of domains) {
    const cost = entryCost(domain);
    if (
      current.length >= MAX_CHUNK_ENTRIES ||
      (current.length > 0 && bytes + cost > MAX_CHUNK_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(domain);
    bytes += cost;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
};

const isCount = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

type Manifest = { readonly chunks: number; readonly count: number; readonly fetchedAt: number };

const readManifest = (value: unknown, source: string, currentTime: number): Manifest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["chunks", "count", "fetchedAt", "schemaVersion", "source"]) ||
    value["schemaVersion"] !== PHISHING_CACHE_VERSION ||
    value["source"] !== source ||
    !isCount(value["chunks"], MAX_CHUNKS) ||
    !isCount(value["count"], MAX_PHISHING_DOMAINS) ||
    typeof value["fetchedAt"] !== "number" ||
    !Number.isFinite(value["fetchedAt"]) ||
    value["fetchedAt"] < 0 ||
    value["fetchedAt"] > currentTime
  ) {
    return null;
  }
  return { chunks: value["chunks"], count: value["count"], fetchedAt: value["fetchedAt"] };
};

// Appends one chunk's domains to `into`, or returns false when the chunk is not
// exactly the expected generation and index or carries any invalid/duplicate
// domain.
const appendChunk = (
  value: unknown,
  index: number,
  fetchedAt: number,
  seen: Set<string>,
  into: string[],
): boolean => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["domains", "fetchedAt", "index"]) ||
    value["index"] !== index ||
    value["fetchedAt"] !== fetchedAt ||
    !Array.isArray(value["domains"]) ||
    value["domains"].length > MAX_CHUNK_ENTRIES
  ) {
    return false;
  }
  for (const entry of value["domains"]) {
    const domain = typeof entry === "string" ? normalizePhishingDomain(entry) : null;
    if (domain === null || domain !== entry || seen.has(domain)) {
      return false;
    }
    seen.add(domain);
    into.push(domain);
  }
  return true;
};

/**
 * Reads the chunked cache for `source`. Never throws: a storage failure, a
 * legacy v1 record, a foreign source, a future timestamp, or any missing or
 * invalid chunk returns null so the caller refetches; a partial list is never
 * returned.
 */
export const readPhishingCache = async (
  store: KeyValueStore,
  source: string,
  currentTime: number,
): Promise<PhishingCache | null> => {
  try {
    const manifest = readManifest(await store.get(PHISHING_FEED_STORE_KEY), source, currentTime);
    if (manifest === null) {
      return null;
    }
    const seen = new Set<string>();
    const domains: string[] = [];
    for (let index = 0; index < manifest.chunks; index += 1) {
      const chunk = await store.get(chunkKey(index));
      if (!appendChunk(chunk, index, manifest.fetchedAt, seen, domains)) {
        return null;
      }
    }
    return domains.length === manifest.count
      ? { domains, fetchedAt: manifest.fetchedAt, source }
      : null;
  } catch {
    return null;
  }
};

/**
 * Persists `cache` as byte-budgeted chunks followed by the manifest, then
 * removes chunk keys left over from a larger earlier generation. Rejects when
 * any write fails (for example a storage quota error); the caller decides how
 * to surface that. A failed write never yields a readable mixed cache, because
 * every chunk is tagged with its generation's `fetchedAt`.
 */
export const writePhishingCache = async (
  store: KeyValueStore,
  cache: PhishingCache,
): Promise<void> => {
  const chunks = splitIntoChunks(cache.domains.slice(0, MAX_PHISHING_DOMAINS));
  if (chunks.length > MAX_CHUNKS) {
    throw new Error("Phishing feed cache exceeds the chunk budget");
  }
  for (const [index, domains] of chunks.entries()) {
    await store.set(chunkKey(index), { domains: [...domains], fetchedAt: cache.fetchedAt, index });
  }
  await store.set(PHISHING_FEED_STORE_KEY, {
    chunks: chunks.length,
    count: chunks.reduce((total, chunk) => total + chunk.length, 0),
    fetchedAt: cache.fetchedAt,
    schemaVersion: PHISHING_CACHE_VERSION,
    source: cache.source,
  });
  for (let index = chunks.length; index < MAX_CHUNKS; index += 1) {
    if ((await store.get(chunkKey(index))) === undefined) {
      break;
    }
    await store.remove(chunkKey(index));
  }
};
