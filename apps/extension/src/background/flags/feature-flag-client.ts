/**
 * Background feature-flag client: fetches the signed bramble-ff document,
 * verifies it, persists the last good copy, and answers flag snapshots.
 *
 * Fail-closed ladder, evaluated on every snapshot:
 * 1. a verified, unexpired document (fresh, or the last good one) applies;
 * 2. otherwise — nothing accepted yet, the last good copy expired, the bundled
 *    keys failed to import, or the install bucket is unavailable — the bundled
 *    defaults apply unchanged.
 *
 * Network, clock, RNG, and storage are injected. The request is a bare `GET`
 * of one fixed URL through {@link fetchBoundedText}: no query string, no
 * headers, no cookies, no referrer, redirects refused. The rollout bucket,
 * version, and chain stay on the device.
 */
import {
  type BoundedHttpFetch,
  fetchBoundedText,
  HTTP_BODY_LIMITS,
} from "@mc-wallet/core/http-json";
import {
  BUNDLED_FLAGS,
  FEATURE_FLAG_CHANNEL,
  FEATURE_FLAG_URL,
  type FlagCatalog,
  TRUSTED_FLAG_KEYS,
} from "@mc-wallet/flags/catalog";
import type { FlagChannel, FlagPayload } from "@mc-wallet/flags/contract";
import { evaluateFlags, type FlagValues } from "@mc-wallet/flags/evaluate";
import {
  EMPTY_FLAG_STATE,
  type FlagState,
  readFlagState,
  readOrCreateFlagBucket,
  writeFlagState,
} from "@mc-wallet/flags/state";
import {
  type FlagRejection,
  importTrustedFlagKeys,
  type TrustedFlagKeys,
  verifyFlagDocument,
} from "@mc-wallet/flags/verify";
import type { KeyValueStore } from "@mc-wallet/store/kv";

/** Minimum spacing between non-forced refreshes (worker wakes). */
export const FEATURE_FLAG_REFRESH_MS = 30 * 60_000;

/** Effective flags plus where they came from. Carries no identifiers. */
type FeatureFlagSnapshot = {
  readonly flags: FlagValues;
  readonly sequence: number | null;
  readonly source: "bundled" | "remote";
};

/** Response for `wallet.featureFlags`. */
export type FeatureFlagsResponse = FeatureFlagSnapshot & { readonly ok: true };

/** Read side handed to message handlers. */
export type FeatureFlagReader = {
  readonly snapshot: (chain: string | null) => Promise<FeatureFlagSnapshot>;
};

/** Result of one refresh attempt, for tests and scheduling only. */
type FeatureFlagRefreshOutcome = "accepted" | "skipped" | "unreachable" | FlagRejection;

/** The full client: read side plus the refresh the scheduler drives. */
export type FeatureFlagClient = FeatureFlagReader & {
  readonly refresh: (options?: { readonly force?: boolean }) => Promise<FeatureFlagRefreshOutcome>;
};

/** Collaborators for {@link createFeatureFlagClient}. */
export type FeatureFlagClientOptions = {
  readonly catalog?: FlagCatalog;
  readonly channel?: FlagChannel;
  readonly drawBucket: () => number;
  readonly fetch: BoundedHttpFetch;
  readonly now: () => number;
  readonly store: KeyValueStore;
  readonly trustedKeys?: () => Promise<TrustedFlagKeys>;
  readonly url?: string;
  /** This build's manifest version (`x.y.z`), or null when unreadable. */
  readonly version: string | null;
};

type Loaded = { payload: FlagPayload | null; state: FlagState };

const bundledSnapshot = (catalog: FlagCatalog): FeatureFlagSnapshot => ({
  flags: { ...Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, v.enabled])) },
  sequence: null,
  source: "bundled",
});

/** Bundled-defaults reader, for contexts with no wired client. */
export const bundledFeatureFlags: FeatureFlagReader = {
  snapshot: async () => bundledSnapshot(BUNDLED_FLAGS),
};

/**
 * Creates the client. Nothing touches the network or storage until the first
 * `snapshot` or `refresh`. Neither method rejects.
 */
export const createFeatureFlagClient = (options: FeatureFlagClientOptions): FeatureFlagClient => {
  const catalog = options.catalog ?? BUNDLED_FLAGS;
  const channel = options.channel ?? FEATURE_FLAG_CHANNEL;
  const url = options.url ?? FEATURE_FLAG_URL;
  const keys = (options.trustedKeys ?? (() => importTrustedFlagKeys(TRUSTED_FLAG_KEYS)))().catch(
    (): TrustedFlagKeys => new Map(),
  );

  const verify = async (text: string, minSequence: number) =>
    verifyFlagDocument(text, {
      channel,
      minSequence,
      now: options.now(),
      trustedKeys: await keys,
    });

  const load = async (): Promise<Loaded> => {
    const state = await readFlagState(options.store, options.now());
    if (state.document === null) {
      return { payload: null, state };
    }
    const stored = await verify(state.document, state.sequence);
    // A stored copy that no longer verifies (expired, tampered, key dropped in
    // this release) keeps its sequence as the rollback floor but stops applying.
    return { payload: stored.ok ? stored.payload : null, state };
  };
  let loaded: Promise<Loaded> | null = null;
  const current = (): Promise<Loaded> => {
    loaded ??= load().catch(() => ({ payload: null, state: EMPTY_FLAG_STATE }));
    return loaded;
  };

  let bucket: Promise<number | null> | null = null;
  const installBucket = (): Promise<number | null> => {
    bucket ??= readOrCreateFlagBucket(options.store, options.drawBucket).catch(() => null);
    return bucket;
  };

  const attempt = async (force: boolean): Promise<FeatureFlagRefreshOutcome> => {
    const live = await current();
    const checkedAt = options.now();
    if (!force && checkedAt - live.state.checkedAt < FEATURE_FLAG_REFRESH_MS) {
      return "skipped";
    }
    const text = await fetchBoundedText(options.fetch, url, HTTP_BODY_LIMITS.flagDocument).catch(
      () => null,
    );
    const verdict = text === null ? null : await verify(text, live.state.sequence);
    if (verdict?.ok) {
      live.payload = verdict.payload;
      live.state = { checkedAt, document: text, sequence: verdict.payload.sequence };
    } else {
      live.state = { ...live.state, checkedAt };
    }
    await writeFlagState(options.store, live.state);
    if (verdict === null) {
      return "unreachable";
    }
    return verdict.ok ? "accepted" : verdict.reason;
  };

  let inflight: Promise<FeatureFlagRefreshOutcome> | null = null;
  return {
    refresh(refreshOptions) {
      inflight ??= attempt(refreshOptions?.force ?? false)
        .catch((): FeatureFlagRefreshOutcome => "unreachable")
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    async snapshot(chain) {
      const [live, installed] = await Promise.all([current(), installBucket()]);
      const payload = live.payload && options.now() < live.payload.expiresAt ? live.payload : null;
      if (payload === null || installed === null) {
        return bundledSnapshot(catalog);
      }
      return {
        flags: evaluateFlags(catalog, payload, {
          bucket: installed,
          chain,
          version: options.version,
        }),
        sequence: payload.sequence,
        source: "remote",
      };
    },
  };
};
