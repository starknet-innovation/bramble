/** Static-artifact privacy-score fetch, verification, rollback, and cache coordinator. */
import { WalletError } from "@mc-wallet/core/errors";
import {
  type BoundedHttpFetch,
  fetchBoundedJson,
  HTTP_BODY_LIMITS,
} from "@mc-wallet/core/http-json";
import { type StarknetNetworkId, sameFelt } from "@mc-wallet/wallet-model/networks";
import { STRK20_MAINNET_POOL } from "../config";
import type {
  PrivacyScoreCache,
  PrivacyScoreCacheEntry,
  PrivacyScoreCheckpoint,
} from "./score-cache";
import { verifyPrivacyScoreEnvelope } from "./score-crypto";
import {
  PRIVACY_SCORE_ORIGIN,
  type PrivacyScoreEnvelope,
  readPrivacyScoreEnvelope,
  readPrivacyScoreManifest,
  sameSnapshotSignature,
} from "./score-schema";
import { type PrivacyScoreTransaction, summarizePrivacyScores } from "./score-summary";
import type { PrivacyScoreState } from "./score-types";

const REFRESH_INTERVAL_MS = 5 * 60_000;
const MAX_SNAPSHOT_AGE_MS = 3 * 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const SNAPSHOT_TIMEOUT_MS = 45_000;

/**
 * Account-scoped input; only public transaction hashes leave the activity store.
 */
export type PrivacyScoreInput = {
  readonly accountId: string;
  readonly networkId: StarknetNetworkId;
  readonly poolAddress: string;
  readonly transactions: readonly PrivacyScoreTransaction[];
};

/**
 * Read-only privacy-score service used by the separate score handler.
 */
export type PrivacyScoreService = {
  /**
   * Returns a verified local association or an explicit unavailable state.
   * No account address, viewing key, amount, or transaction hash is sent to the
   * score origin: every request is for the same two static public files.
   */
  readonly score: (input: PrivacyScoreInput) => Promise<PrivacyScoreState>;
};

type ServiceOptions = {
  readonly cache: PrivacyScoreCache;
  readonly http: BoundedHttpFetch;
  readonly now: () => number;
  /** Test seam; production wiring always uses the pinned default verifier. */
  readonly verify?: typeof verifyPrivacyScoreEnvelope;
};

const transactionKeys = (transactions: readonly PrivacyScoreTransaction[]): readonly string[] =>
  transactions.map((transaction) => transaction.hash).sort();

const sameKeys = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((key, index) => key === right[index]);

const generatedAge = (state: PrivacyScoreState, now: number): number | null =>
  state.status === "available" ? now - Date.parse(state.generatedAt) : null;

const cachedResult = (
  entry: PrivacyScoreCacheEntry | undefined,
  keys: readonly string[],
  now: number,
  requireRecentCheck: boolean,
): PrivacyScoreState | null => {
  if (
    !entry ||
    !sameKeys(entry.transactionKeys, keys) ||
    entry.checkedAt > now + MAX_FUTURE_SKEW_MS ||
    (requireRecentCheck && now - entry.checkedAt > REFRESH_INTERVAL_MS)
  ) {
    return null;
  }
  const age = generatedAge(entry.score, now);
  if (age !== null && (age < -MAX_FUTURE_SKEW_MS || age > MAX_SNAPSHOT_AGE_MS)) {
    return { status: "stale" };
  }
  return entry.score;
};

const assertMonotonic = (
  checkpoint: PrivacyScoreCheckpoint | undefined,
  envelope: Pick<PrivacyScoreEnvelope, "snapshotBlockHash" | "snapshotBlockNumber">,
): void => {
  if (!checkpoint) {
    return;
  }
  if (envelope.snapshotBlockNumber < checkpoint.snapshotBlockNumber) {
    throw new WalletError("Privacy score snapshot rolled back");
  }
  if (
    envelope.snapshotBlockNumber === checkpoint.snapshotBlockNumber &&
    !sameFelt(envelope.snapshotBlockHash, checkpoint.snapshotBlockHash)
  ) {
    throw new WalletError("Privacy score finalized checkpoint changed");
  }
};

const scoreSnapshot = (
  snapshot: PrivacyScoreEnvelope,
  transactions: readonly PrivacyScoreTransaction[],
  checkedAt: number,
): PrivacyScoreState => {
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (
    generatedAt > checkedAt + MAX_FUTURE_SKEW_MS ||
    checkedAt - generatedAt > MAX_SNAPSHOT_AGE_MS
  ) {
    return { status: "stale" };
  }
  return summarizePrivacyScores(snapshot.withdrawals, transactions, snapshot);
};

const scoreAfterCacheWrite = async (
  cache: PrivacyScoreCache,
  stored: boolean,
  input: PrivacyScoreInput,
  keys: readonly string[],
  score: PrivacyScoreState,
  now: number,
): Promise<PrivacyScoreState> => {
  if (stored) {
    return score;
  }
  const latest = await cache.read();
  const latestEntry = latest.accounts.find(
    (entry) => entry.accountId === input.accountId && entry.networkId === input.networkId,
  );
  return cachedResult(latestEntry, keys, now, false) ?? { status: "unavailable" };
};

/**
 * Creates the production signed-artifact privacy-score service.
 */
export const createPrivacyScoreService = ({
  cache,
  http,
  now,
  verify = verifyPrivacyScoreEnvelope,
}: ServiceOptions): PrivacyScoreService => {
  let memorySnapshot: PrivacyScoreEnvelope | null = null;

  const verifiedSnapshot = async (
    checkpoint: PrivacyScoreCheckpoint | undefined,
  ): Promise<PrivacyScoreEnvelope> => {
    const manifestInput = await fetchBoundedJson(
      http,
      `${PRIVACY_SCORE_ORIGIN}/v1/latest.json`,
      HTTP_BODY_LIMITS.price,
    );
    const manifest = readPrivacyScoreManifest(manifestInput);
    if (!manifest) {
      throw new WalletError("Privacy score manifest was invalid");
    }
    const expectedKey = `v1/snapshots/${manifest.snapshotBlockNumber}-${manifest.snapshotBlockHash.slice(2, 18)}-${manifest.payloadSha256.slice(0, 16)}.json.gz`;
    if (manifest.snapshotKey !== expectedKey) {
      throw new WalletError("Privacy score snapshot key was invalid");
    }
    if (
      memorySnapshot &&
      memorySnapshot.generatedAt === manifest.generatedAt &&
      memorySnapshot.payloadSha256 === manifest.payloadSha256 &&
      memorySnapshot.snapshotBlockNumber === manifest.snapshotBlockNumber &&
      sameFelt(memorySnapshot.snapshotBlockHash, manifest.snapshotBlockHash) &&
      sameSnapshotSignature(manifest.signature, memorySnapshot.signature)
    ) {
      assertMonotonic(checkpoint, memorySnapshot);
      return memorySnapshot;
    }
    const snapshotInput = await fetchBoundedJson(
      http,
      `${PRIVACY_SCORE_ORIGIN}/${manifest.snapshotKey}`,
      HTTP_BODY_LIMITS.privacyScore,
      SNAPSHOT_TIMEOUT_MS,
    );
    const envelope = readPrivacyScoreEnvelope(snapshotInput);
    if (
      !envelope ||
      envelope.generatedAt !== manifest.generatedAt ||
      envelope.payloadSha256 !== manifest.payloadSha256 ||
      envelope.snapshotBlockNumber !== manifest.snapshotBlockNumber ||
      !sameFelt(envelope.snapshotBlockHash, manifest.snapshotBlockHash) ||
      !sameSnapshotSignature(manifest.signature, envelope.signature)
    ) {
      throw new WalletError("Privacy score snapshot did not match its manifest");
    }
    assertMonotonic(checkpoint, envelope);
    if (!(await verify(envelope, manifest))) {
      throw new WalletError("Privacy score signature was invalid");
    }
    memorySnapshot = envelope;
    return envelope;
  };

  return {
    async score(input) {
      if (input.networkId !== "SN_MAIN" || !sameFelt(input.poolAddress, STRK20_MAINNET_POOL)) {
        return { status: "unsupported" };
      }
      if (input.transactions.length === 0) {
        return { status: "no-withdrawals" };
      }
      const keys = transactionKeys(input.transactions);
      const state = await cache.read();
      const existing = state.accounts.find(
        (entry) => entry.accountId === input.accountId && entry.networkId === input.networkId,
      );
      const recent = cachedResult(existing, keys, now(), true);
      if (recent) {
        return recent;
      }
      try {
        const snapshot = await verifiedSnapshot(state.checkpoint);
        const checkedAt = now();
        const score = scoreSnapshot(snapshot, input.transactions, checkedAt);
        const stored = await cache.write(
          {
            snapshotBlockHash: snapshot.snapshotBlockHash,
            snapshotBlockNumber: snapshot.snapshotBlockNumber,
          },
          {
            accountId: input.accountId,
            checkedAt,
            networkId: input.networkId,
            score,
            transactionKeys: keys,
          },
        );
        return scoreAfterCacheWrite(cache, stored, input, keys, score, now());
      } catch {
        return cachedResult(existing, keys, now(), false) ?? { status: "unavailable" };
      }
    },
  };
};

/**
 * Explicit fail-closed default for tests and runtimes without score wiring.
 */
export const unavailablePrivacyScoreService: PrivacyScoreService = {
  async score() {
    return { status: "unavailable" };
  },
};
