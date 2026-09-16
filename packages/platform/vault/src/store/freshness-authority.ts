/**
 * The authorities that vouch for an encrypted envelope's freshness.
 *
 * Every committed envelope carries a `commit` and a `lineage`, and a store
 * accepts one only while an authority still names that commit as current — or
 * as the pending half of an interrupted write. That is what makes replaying an
 * older, perfectly authentic envelope a detectable rollback rather than a
 * successful one.
 *
 * There are two authorities because they have different integrity. The durable
 * one is `storage.sync`, which survives a browser restart but which this
 * extension's own content script can write on Firefox — Gecko implements no
 * `storage.setAccessLevel`, so `local` and `sync` cannot be closed off. An
 * attacker with code execution there rewrites the envelope and its commit state
 * together, and the pair stays self-consistent. The session-scoped shadow lives
 * in `storage.session`, which defaults to trusted contexts on every browser and
 * so cannot be reached from a content script at all; a `sync` state rolled back
 * underneath it disagrees and is refused.
 *
 * The shadow narrows that window rather than closing it: `storage.session` is
 * cleared when the browser exits, so the first read of each session has nothing
 * to compare against. That read seeds the shadow with the commit it accepted,
 * so the window is one read and not the stretch until the next write. A
 * runtime without session storage has no shadow at all. Alongside the
 * per-lineage records the shadow keeps one store-wide marker naming the last
 * lineage promoted to current, because a version-2 envelope carries no lineage
 * and a downgrade to one could otherwise not be caught. Split out of
 * `../encrypted-store` because deciding who vouches for an envelope is a
 * different job from encrypting one.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { KeyValueStore } from "@bramble/store/kv";
import { hasBase64Bytes } from "./envelope-bytes";

const COMMIT_STATE_KEYS = ["current", "pending", "version"] as const;
const PROMOTED_STATE_KEYS = ["lineage", "version"] as const;

/**
 * The freshness record for one lineage. `pending` is non-null only between the
 * two halves of a write, which is why an envelope naming it is still accepted:
 * that is a crash mid-commit, not a rollback.
 */
type CommitState = {
  readonly current: string | null;
  readonly pending: string | null;
  readonly version: 1;
};

/**
 * The session-only record that a committed lineage has been current for this
 * store during the browser session. Its presence makes a version-2 envelope a
 * downgrade rather than a vault that was never migrated.
 */
type PromotedState = { readonly lineage: string; readonly version: 1 };

/** Validates a stored commit record. Storage is untrusted; shape is not assumed. */
const isCommitState = (value: unknown): value is CommitState =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, COMMIT_STATE_KEYS) &&
  (value["current"] === null ||
    (typeof value["current"] === "string" && hasBase64Bytes(value["current"], 16))) &&
  (value["pending"] === null ||
    (typeof value["pending"] === "string" && hasBase64Bytes(value["pending"], 16))) &&
  value["version"] === 1;

const isPromotedState = (value: unknown): value is PromotedState =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, PROMOTED_STATE_KEYS) &&
  typeof value["lineage"] === "string" &&
  /^[0-9a-f]{32}$/.test(value["lineage"]) &&
  value["version"] === 1;

/**
 * Whether an authority vouches for a commit: it is the committed one, or the
 * pending one of a write that was interrupted before it could be promoted.
 */
const vouchesFor = (state: CommitState, commit: string): boolean =>
  state.current === commit || state.pending === commit;

/** The two authorities a store writes its freshness records to. */
export type FreshnessAuthority = {
  /** Reads the durable record for a lineage, or undefined when there is none. */
  readonly read: (lineage: string) => Promise<CommitState | undefined>;
  /**
   * Throws when this session has already seen a committed lineage current for
   * the store: a version-2 envelope read afterwards is a downgrade. Silent when
   * there is no shadow store.
   */
  readonly requireNotPromoted: () => Promise<void>;
  /**
   * Throws when the session shadow holds a record for this lineage that does
   * not vouch for the commit. When the shadow holds nothing for the lineage —
   * the first read of a session — the accepted commit is recorded as the
   * shadow, so only that one read goes unprotected. Silent when there is no
   * shadow store.
   */
  readonly requireShadow: (lineage: string, commit: string) => Promise<void>;
  /** Removes the record from both authorities. */
  readonly remove: (lineage: string) => Promise<void>;
  /** Records a transition in both authorities, the shadow first. */
  readonly set: (lineage: string, state: CommitState) => Promise<void>;
};

/**
 * Builds the freshness authority for one store key.
 *
 * `sessionFreshnessStore` is optional because a runtime may have no session
 * storage; its absence means the durable authority is the only one, which is
 * the behaviour this store had before the shadow existed.
 */
export const createFreshnessAuthority = (
  key: string,
  freshnessStore: KeyValueStore,
  sessionFreshnessStore?: KeyValueStore,
): FreshnessAuthority => {
  const commitKey = (lineage: string): string => `${key}:commit:${lineage}`;
  const promotedKey = `${key}:promoted`;

  const readFrom = async (
    authority: KeyValueStore,
    lineage: string,
  ): Promise<CommitState | undefined> => {
    const state = await authority.get(commitKey(lineage));
    if (state === undefined) {
      return undefined;
    }
    if (!isCommitState(state)) {
      throw new WalletError("Invalid encrypted store commit state");
    }
    return state;
  };

  const readPromoted = async (): Promise<PromotedState | undefined> => {
    const state = await sessionFreshnessStore?.get(promotedKey);
    if (state === undefined) {
      return undefined;
    }
    if (!isPromotedState(state)) {
      throw new WalletError("Invalid encrypted store commit state");
    }
    return state;
  };

  // The shadow is the higher-integrity authority, so it must never lag the
  // durable one: a shadow left naming the previous commit as current while
  // the durable record had already moved on would still vouch for that
  // commit, and restoring it together with its old durable state would pass
  // both checks. A shadow that runs ahead is harmless — through `current` it
  // still vouches for the envelope on disk, and a pending commit only it
  // names was never written anywhere an attacker could replay it from.
  const writeShadow = async (lineage: string, state: CommitState): Promise<void> => {
    if (!sessionFreshnessStore) {
      return;
    }
    await sessionFreshnessStore.set(commitKey(lineage), state);
    if (state.current !== null) {
      await sessionFreshnessStore.set(promotedKey, { lineage, version: 1 });
    }
  };

  return {
    read: (lineage) => readFrom(freshnessStore, lineage),
    async remove(lineage) {
      await freshnessStore.remove(commitKey(lineage));
      if (!sessionFreshnessStore) {
        return;
      }
      await sessionFreshnessStore.remove(commitKey(lineage));
      if ((await readPromoted())?.lineage === lineage) {
        await sessionFreshnessStore.remove(promotedKey);
      }
    },
    async requireNotPromoted() {
      if ((await readPromoted()) !== undefined) {
        throw new WalletError("Encrypted store rollback detected");
      }
    },
    async requireShadow(lineage, commit) {
      if (!sessionFreshnessStore) {
        return;
      }
      const shadow = await readFrom(sessionFreshnessStore, lineage);
      if (shadow === undefined) {
        await writeShadow(lineage, { current: commit, pending: null, version: 1 });
        return;
      }
      if (!vouchesFor(shadow, commit)) {
        throw new WalletError("Encrypted store rollback detected");
      }
    },
    async set(lineage, state) {
      await writeShadow(lineage, state);
      await freshnessStore.set(commitKey(lineage), state);
    },
  };
};
