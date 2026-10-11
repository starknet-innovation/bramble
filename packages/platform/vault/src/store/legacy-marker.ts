/**
 * The store-wide marker that refuses a version-2 envelope once a version-3
 * commit exists.
 *
 * It is deliberately store-wide, not keyed to the one v2 envelope present
 * during migration: once any v3 commit for this store is current, every earlier
 * authentic v2 envelope must be rejected. It lives beside the envelope, not in
 * the durable freshness area: `storage.sync` is shared by every synced install
 * of this extension, and a marker one install wrote there refused another
 * install's own, never-migrated v2 vault. A marker left there by an earlier
 * release is moved beside the envelope by the first committed read. Split out
 * of `../encrypted-store` because deciding whether a v2 envelope is a downgrade
 * is a different job from encrypting one.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import type { FreshnessAuthority } from "./freshness-authority";

const LEGACY_STATE_KEYS = ["lineage", "version"] as const;

type LegacyState = { readonly lineage: string; readonly version: 1 };

const isLegacyState = (value: unknown): value is LegacyState =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, LEGACY_STATE_KEYS) &&
  typeof value["lineage"] === "string" &&
  /^[0-9a-f]{32}$/.test(value["lineage"]) &&
  value["version"] === 1;

/** The v2 downgrade marker for one store key. */
export type LegacyMarker = {
  /**
   * Admits a v2 envelope only while no v3 commit for this store has been
   * current, aborting a v2-to-v3 migration interrupted before its envelope
   * write. Throws a rollback when the envelope is a downgrade.
   */
  readonly recover: <T>(envelope: T) => Promise<T>;
  /** Records the marker for a v2-to-v3 migration about to write `lineage`. */
  readonly prepare: (lineage: string) => Promise<void>;
  /**
   * Records the marker after a committed read of `lineage`, and removes an
   * earlier release's shared marker when it names this lineage.
   */
  readonly claim: (lineage: string) => Promise<void>;
};

/**
 * Builds the marker for one store key. `store` holds the envelope and the
 * marker; `freshnessStore` is read only to remove a marker an earlier release
 * left there.
 */
export const createLegacyMarker = (
  key: string,
  store: KeyValueStore,
  freshnessStore: KeyValueStore,
  freshness: FreshnessAuthority,
): LegacyMarker => {
  const legacyKey = `${key}:legacy`;
  return {
    async recover(envelope) {
      // A legacy envelope carries no lineage for the session shadow to check, so
      // the shadow answers store-wide instead: once a committed lineage has been
      // current in this session, any version-2 envelope is a downgrade — even one
      // whose durable legacy marker was deleted along with it.
      await freshness.requireNotPromoted();
      const legacy = await store.get(legacyKey);
      if (legacy === undefined) {
        return envelope;
      }
      if (!isLegacyState(legacy)) {
        throw new WalletError("Invalid encrypted store commit state");
      }
      const state = await freshness.read(legacy.lineage);
      if (state === undefined) {
        // The legacy marker is written only after the pending commit state. Its
        // presence without that state cannot be a valid interrupted write; it is
        // lost/corrupt freshness authority and must not reopen v2 rollback.
        throw new WalletError("Encrypted store rollback detected");
      }
      if (state.current === null && state.pending !== null) {
        // Migration crashed after both prepare records but before replacing the
        // legacy envelope. Abort that uncommitted write and keep v2 recoverable.
        // The marker goes first: a crash between the two then leaves the
        // never-migrated state, not a marker naming records that are gone.
        await store.remove(legacyKey);
        await freshness.remove(legacy.lineage);
        return envelope;
      }
      throw new WalletError("Encrypted store rollback detected");
    },
    async prepare(lineage) {
      const legacy = await store.get(legacyKey);
      if (legacy !== undefined && !isLegacyState(legacy)) {
        throw new WalletError("Invalid encrypted store commit state");
      }
      if (legacy === undefined) {
        await store.set(legacyKey, { lineage, version: 1 });
      }
    },
    // A committed envelope that has just been accepted proves this store is
    // past version 2, so the local marker can be written without a write: an
    // install migrated by an earlier release, whose marker went to the shared
    // area, gets its own here. The shared marker is removed only when it names
    // this lineage, so it stops refusing the v2 vault of another synced install
    // still on an earlier release; a marker naming another lineage is not ours.
    async claim(lineage) {
      if ((await store.get(legacyKey)) === undefined) {
        await store.set(legacyKey, { lineage, version: 1 });
      }
      if (freshnessStore === store) {
        return;
      }
      const shared = await freshnessStore.get(legacyKey);
      if (isLegacyState(shared) && shared.lineage === lineage) {
        await freshnessStore.remove(legacyKey);
      }
    },
  };
};
