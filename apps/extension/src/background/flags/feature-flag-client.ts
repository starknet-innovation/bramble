/**
 * Background feature-flag client: fetches the signed bramble-ff document,
 * verifies it, persists the last good copy, and answers flag snapshots.
 *
 * Fail-closed ladder, evaluated on every snapshot:
 * 1. a verified, unexpired document (fresh, or the last good one) applies;
 * 2. otherwise — nothing accepted yet, the last good copy expired, the stored
 *    state could not be read, or the bundled keys failed to import — the
 *    bundled defaults apply unchanged. Expiry falling back to the defaults is
 *    by design: a kill lasts only as long as the signed copy that carries it.
 *
 * An install bucket that cannot be drawn or stored only withholds the
 * rollout-dependent decisions; a remote kill still applies without one.
 *
 * Local overrides (Settings > Experimental features) apply last, through
 * `@bramble/flags/overrides`: only catalog flags marked `localOverride`, and
 * never over a remote hard kill.
 *
 * Network, clock, RNG, and storage are injected. The request is a bare `GET`
 * of one fixed URL through {@link fetchBoundedText}: no query string, no
 * headers, no cookies, no referrer, redirects refused. The rollout bucket,
 * version, and chain stay on the device.
 */
import { type BoundedHttpFetch, fetchBoundedText, HTTP_BODY_LIMITS } from "@bramble/core/http-json";
import {
  BUNDLED_FLAGS,
  FEATURE_FLAG_CHANNEL,
  FEATURE_FLAG_URL,
  type FlagCatalog,
  TRUSTED_FLAG_KEYS,
} from "@bramble/flags/catalog";
import type { FlagChannel, FlagPayload } from "@bramble/flags/contract";
import { evaluateFlags, type FlagValues } from "@bramble/flags/evaluate";
import {
  applyFlagOverrides,
  type FlagOverrides,
  isOverridableFlag,
  overridableFlags,
  readFlagOverrides,
  writeFlagOverrides,
} from "@bramble/flags/overrides";
import {
  EMPTY_FLAG_STATE,
  type FlagState,
  readFlagState,
  readOrCreateFlagBucket,
  writeFlagState,
} from "@bramble/flags/state";
import {
  type FlagRejection,
  importTrustedFlagKeys,
  type TrustedFlagKeys,
  verifyFlagDocument,
} from "@bramble/flags/verify";
import type { KeyValueStore } from "@bramble/store/kv";

/** Minimum spacing between non-forced refreshes (worker wakes). */
export const FEATURE_FLAG_REFRESH_MS = 30 * 60_000;

/**
 * Effective flags plus where they came from. Carries no identifiers.
 * `source` describes the base values; `overridden` lists flags a local
 * override replaced, and `killed` the overridable flags a remote hard kill
 * pins off.
 */
type FeatureFlagSnapshot = {
  readonly flags: FlagValues;
  readonly killed: readonly string[];
  readonly overridable: readonly string[];
  readonly overridden: readonly string[];
  readonly sequence: number | null;
  readonly source: "bundled" | "remote";
};

/** Outcome of an override write: applied, not allowed, or not persisted. */
export type FeatureFlagOverrideResult = "applied" | "not-overridable" | "unavailable";

/** Response for `wallet.featureFlags`. */
export type FeatureFlagsResponse = FeatureFlagSnapshot & { readonly ok: true };

/** Read side plus local overrides, handed to message handlers. */
export type FeatureFlagReader = {
  readonly snapshot: (chain: string | null) => Promise<FeatureFlagSnapshot>;
  /** Sets (`true`/`false`) or clears (`null`) one flag's local override. */
  readonly setOverride: (key: string, value: boolean | null) => Promise<FeatureFlagOverrideResult>;
  /** Removes every local override. */
  readonly clearOverrides: () => Promise<FeatureFlagOverrideResult>;
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

// `readable` is false when the stored state could not be read: nothing is
// applied or fetched then, so a transient storage failure can neither lower
// the rollback floor nor be mistaken for a fresh install.
type Loaded = { payload: FlagPayload | null; readable: boolean; state: FlagState };

const UNREADABLE: Loaded = { payload: null, readable: false, state: EMPTY_FLAG_STATE };

const bundledValues = (catalog: FlagCatalog): FlagValues =>
  Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, v.enabled]));

/**
 * Bundled-defaults reader, for contexts with no wired client (no storage).
 * Overrides cannot be stored, so every write answers `unavailable`.
 */
export const bundledFeatureFlags: FeatureFlagReader = {
  clearOverrides: async () => "unavailable",
  setOverride: async () => "unavailable",
  snapshot: async () => ({
    flags: bundledValues(BUNDLED_FLAGS),
    killed: [],
    overridable: [],
    overridden: [],
    sequence: null,
    source: "bundled",
  }),
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
    if (state === null) {
      return UNREADABLE;
    }
    if (state.document === null) {
      return { payload: null, readable: true, state };
    }
    const stored = await verify(state.document, state.sequence);
    // A stored copy that no longer verifies (expired, tampered, key dropped in
    // this release) keeps its sequence as the rollback floor but stops applying.
    return { payload: stored.ok ? stored.payload : null, readable: true, state };
  };
  // Memoised once read; an unreadable store is retried on the next call.
  let loaded: Promise<Loaded> | null = null;
  const current = (): Promise<Loaded> => {
    loaded ??= load()
      .catch(() => UNREADABLE)
      .then((result) => {
        if (!result.readable) {
          loaded = null;
        }
        return result;
      });
    return loaded;
  };

  let bucket: Promise<number | null> | null = null;
  const installBucket = (): Promise<number | null> => {
    bucket ??= readOrCreateFlagBucket(options.store, options.drawBucket).catch(() => null);
    return bucket;
  };

  const attempt = async (force: boolean): Promise<FeatureFlagRefreshOutcome> => {
    const live = await current();
    if (!live.readable) {
      return "unreachable";
    }
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

  // Overrides are read once and then kept in memory, like the document state.
  let overrides: Promise<FlagOverrides> | null = null;
  const currentOverrides = (): Promise<FlagOverrides> => {
    overrides ??= readFlagOverrides(options.store, catalog).catch(() => ({}));
    return overrides;
  };
  const saveOverrides = async (next: FlagOverrides): Promise<FeatureFlagOverrideResult> => {
    if (!(await writeFlagOverrides(options.store, next))) {
      return "unavailable";
    }
    overrides = Promise.resolve(next);
    return "applied";
  };

  // Override writes are read-modify-write on the whole map, so they run one
  // after another; two rapid writes would otherwise clobber each other.
  let overrideQueue: Promise<unknown> = Promise.resolve();
  const serialised = <T>(work: () => Promise<T>): Promise<T> => {
    const run = overrideQueue.then(work, work);
    overrideQueue = run.catch(() => undefined);
    return run;
  };

  let inflight: Promise<FeatureFlagRefreshOutcome> | null = null;
  return {
    clearOverrides() {
      return serialised(() => saveOverrides({}));
    },
    setOverride(key, value) {
      if (!isOverridableFlag(catalog, key)) {
        return Promise.resolve("not-overridable");
      }
      return serialised(async () => {
        const rest = Object.fromEntries(
          Object.entries(await currentOverrides()).filter(([existing]) => existing !== key),
        );
        return saveOverrides(value === null ? rest : { ...rest, [key]: value });
      });
    },
    refresh(refreshOptions) {
      inflight ??= attempt(refreshOptions?.force ?? false)
        .catch((): FeatureFlagRefreshOutcome => "unreachable")
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    async snapshot(chain) {
      const [live, installed, local] = await Promise.all([
        current(),
        installBucket(),
        currentOverrides(),
      ]);
      const payload = live.payload && options.now() < live.payload.expiresAt ? live.payload : null;
      const base =
        payload === null
          ? bundledValues(catalog)
          : evaluateFlags(catalog, payload, { bucket: installed, chain, version: options.version });
      return {
        ...applyFlagOverrides(base, local, catalog, payload),
        overridable: overridableFlags(catalog),
        sequence: payload?.sequence ?? null,
        source: payload === null ? "bundled" : "remote",
      };
    },
  };
};
