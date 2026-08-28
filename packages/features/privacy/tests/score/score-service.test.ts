/** Static request privacy, durable rollback, and cache behavior. */
import { describe, expect, test } from "bun:test";
import { HTTP_BODY_LIMITS } from "@mc-wallet/core/http-json";
import { canonicalJson } from "@mc-wallet/core/json";
import { STRK20_MAINNET_POOL } from "@mc-wallet/privacy/config";
import { createPrivacyScoreCache } from "@mc-wallet/privacy/score-cache";
import { createPrivacyScoreService } from "@mc-wallet/privacy/score-service";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { PRIVACY_SCORE_KEY_ID, PRIVACY_SCORE_ORIGIN } from "../../src/score/score-schema";

const TX_HASH = "0x123";
const GENERATED_AT = "2026-08-28T12:00:00.000Z";
const DIGEST = "a".repeat(64);
const SIGNATURE = {
  algorithm: "ECDSA_SHA_256",
  keyId: PRIVACY_SCORE_KEY_ID,
  value: "MAYCAQECAQE=",
};

const artifact = (block: number, blockHash: string) => {
  const payload = {
    chainId: "SN_MAIN",
    completeness: { completeFromDeployment: true, deploymentBlock: 8_978_970 },
    generatedAt: GENERATED_AT,
    model: {
      addressReuseBoost: 25,
      amountLogSigma: 1.5,
      exactAmountBoost: 4,
      id: "effective-min-entropy-v1",
      lookbackDays: 180,
      recencyHalfLifeDays: 30,
      sameTransactionBoost: 100,
      targetEffectiveSet: 100,
    },
    poolAddress: STRK20_MAINNET_POOL,
    poolMetrics: [],
    publicEvents: [],
    schemaVersion: 1,
    snapshotBlockHash: blockHash,
    snapshotBlockNumber: block,
    withdrawals: [
      {
        amount: "1000",
        asOfBlock: block,
        candidateCount: 20,
        confidence: "medium",
        effectiveAnonymitySet: 10,
        eventId: `${TX_HASH}:1`,
        factors: [
          "20 same-token deposits in the lookback window",
          "no exact public amount match",
          "no recipient reuse observed",
          "no same-transaction deposit observed",
        ],
        maxProbability: 0.1,
        score: 50,
        token: "0x456",
        transactionHash: TX_HASH,
      },
    ],
  };
  const envelope = { payload, payloadSha256: DIGEST, signature: SIGNATURE };
  const manifest = {
    generatedAt: GENERATED_AT,
    payloadSha256: DIGEST,
    schemaVersion: 1,
    signature: SIGNATURE,
    snapshotBlockHash: blockHash,
    snapshotBlockNumber: block,
    snapshotKey: `v1/snapshots/${block}-${blockHash.slice(2).padStart(16, "0")}-${DIGEST.slice(0, 16)}.json.gz`,
  };
  return { envelope, manifest };
};

const input = {
  accountId: "SN_MAIN:0xabc",
  networkId: "SN_MAIN" as const,
  poolAddress: STRK20_MAINNET_POOL,
  transactions: [{ hash: TX_HASH }],
};

const cacheEntry = (accountId: string, checkedAt: number) => ({
  accountId,
  checkedAt,
  networkId: "SN_MAIN" as const,
  score: { status: "pending" as const },
  transactionKeys: [TX_HASH],
});

const responseFor = (url: string, current: ReturnType<typeof artifact>) => {
  const input = url.endsWith("latest.json") ? current.manifest : current.envelope;
  return {
    json: async () => input,
    ok: true,
    text: async () => canonicalJson(input),
  };
};

describe("privacy score service", () => {
  test("requests only shared static files and caches a verified local association", async () => {
    const backing = createMemoryStore();
    const cache = createPrivacyScoreCache(backing);
    let current = artifact(100, "0x0000000000000abc");
    let clock = Date.parse(GENERATED_AT) + 1_000;
    const urls: string[] = [];
    let verifications = 0;
    const service = createPrivacyScoreService({
      cache,
      http: async (url) => {
        urls.push(url);
        return responseFor(url, current);
      },
      now: () => clock,
      verify: async () => {
        verifications += 1;
        return true;
      },
    });

    expect(await service.score(input)).toMatchObject({ score: 50, status: "available" });
    expect(urls).toEqual([
      `${PRIVACY_SCORE_ORIGIN}/v1/latest.json`,
      `${PRIVACY_SCORE_ORIGIN}/${current.manifest.snapshotKey}`,
    ]);
    expect(urls.every((url) => !url.includes("?"))).toBe(true);
    expect(verifications).toBe(1);

    expect(await service.score(input)).toMatchObject({ score: 50, status: "available" });
    expect(urls).toHaveLength(2);
    expect((await cache.read()).checkpoint).toEqual({
      snapshotBlockHash: "0x0000000000000abc",
      snapshotBlockNumber: 100,
    });

    clock += 6 * 60_000;
    current = artifact(99, "0x0000000000000def");
    expect(await service.score(input)).toMatchObject({ score: 50, status: "available" });
    expect((await cache.read()).checkpoint?.snapshotBlockNumber).toBe(100);
    expect(verifications).toBe(1);

    clock += 6 * 60_000;
    current = artifact(100, "0x0000000000000def");
    expect(await service.score(input)).toMatchObject({ score: 50, status: "available" });
    expect((await cache.read()).checkpoint).toEqual({
      snapshotBlockHash: "0x0000000000000abc",
      snapshotBlockNumber: 100,
    });
    expect(verifications).toBe(1);
  });

  test("fails closed when the manifest and snapshot disagree", async () => {
    const current = artifact(100, "0x0000000000000abc");
    current.manifest.payloadSha256 = "b".repeat(64);
    current.manifest.snapshotKey = current.manifest.snapshotKey.replace(
      "a".repeat(16),
      "b".repeat(16),
    );
    const service = createPrivacyScoreService({
      cache: createPrivacyScoreCache(createMemoryStore()),
      http: async (url) => responseFor(url, current),
      now: () => Date.parse(GENERATED_AT) + 1_000,
      verify: async () => true,
    });

    expect(await service.score(input)).toEqual({ status: "unavailable" });
  });

  test("rejects an oversized score from Content-Length before reading its body", async () => {
    const current = artifact(100, "0x0000000000000abc");
    let snapshotBodyRead = false;
    const service = createPrivacyScoreService({
      cache: createPrivacyScoreCache(createMemoryStore()),
      http: async (url) => {
        if (url.endsWith("latest.json")) return responseFor(url, current);
        return {
          headers: new Headers({
            "content-length": String(HTTP_BODY_LIMITS.privacyScore + 1),
          }),
          json: async () => current.envelope,
          ok: true,
          text: async () => {
            snapshotBodyRead = true;
            return canonicalJson(current.envelope);
          },
        };
      },
      now: () => Date.parse(GENERATED_AT) + 1_000,
      verify: async () => true,
    });

    expect(await service.score(input)).toEqual({ status: "unavailable" });
    expect(snapshotBodyRead).toBe(false);
  });

  test("shares one manifest, snapshot, and verification across overlapping refreshes", async () => {
    const current = artifact(100, "0x0000000000000abc");
    const urls: string[] = [];
    let releaseSnapshot: (() => void) | undefined;
    const snapshotReady = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    let verifications = 0;
    const service = createPrivacyScoreService({
      cache: createPrivacyScoreCache(createMemoryStore()),
      http: async (url) => {
        urls.push(url);
        if (url.endsWith("latest.json")) return responseFor(url, current);
        return {
          json: async () => current.envelope,
          ok: true,
          text: async () => {
            await snapshotReady;
            return canonicalJson(current.envelope);
          },
        };
      },
      now: () => Date.parse(GENERATED_AT) + 1_000,
      verify: async () => {
        verifications += 1;
        return true;
      },
    });

    const first = service.score(input);
    const second = service.score({ ...input, accountId: "SN_MAIN:0xdef" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(urls).toHaveLength(2);
    releaseSnapshot?.();

    expect(await first).toMatchObject({ score: 50, status: "available" });
    expect(await second).toMatchObject({ score: 50, status: "available" });
    expect(urls).toHaveLength(2);
    expect(verifications).toBe(1);
  });

  test("rejects an older or conflicting checkpoint inside serialized cache writes", async () => {
    const cache = createPrivacyScoreCache(createMemoryStore());
    const newest = {
      snapshotBlockHash: "0x0000000000000abc",
      snapshotBlockNumber: 101,
    };
    expect(await cache.write(newest, cacheEntry("SN_MAIN:0xabc", 1))).toBe(true);

    expect(
      await cache.write(
        { snapshotBlockHash: "0x0000000000000def", snapshotBlockNumber: 100 },
        cacheEntry("SN_MAIN:0xdef", 2),
      ),
    ).toBe(false);
    expect(
      await cache.write(
        { snapshotBlockHash: "0x0000000000000123", snapshotBlockNumber: 101 },
        cacheEntry("SN_MAIN:0xdef", 3),
      ),
    ).toBe(false);

    const state = await cache.read();
    expect(state.checkpoint).toEqual(newest);
    expect(state.accounts.map((entry) => entry.accountId)).toEqual(["SN_MAIN:0xabc"]);
  });
});
