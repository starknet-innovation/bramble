/** Signed score verification and conservative local association. */
import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@mc-wallet/core/hex";
import { canonicalJson } from "@mc-wallet/core/json";
import { STRK20_MAINNET_POOL } from "@mc-wallet/privacy/config";
import { privacyScoreDerToP1363, verifyPrivacyScoreEnvelope } from "../../src/score/score-crypto";
import {
  PRIVACY_SCORE_KEY_ID,
  readPrivacyScoreEnvelope,
  readPrivacyScoreManifest,
  type WithdrawalScore,
} from "../../src/score/score-schema";
import { summarizePrivacyScores } from "../../src/score/score-summary";

const HASH_ONE = "0x123";
const HASH_TWO = "0x456";

const scoreRow = (overrides: Partial<WithdrawalScore> = {}): WithdrawalScore => ({
  amount: "1000",
  candidateCount: 94,
  confidence: "high",
  effectiveAnonymitySet: 28,
  eventId: `${HASH_ONE}:4`,
  factors: ["94 same-token deposits", "no exact public amount match"],
  score: 72,
  token: "0x789",
  transactionHash: HASH_ONE,
  ...overrides,
});

const scalarDer = (raw: Uint8Array): number[] => {
  const withoutZeroes = [...raw].slice(raw.findIndex((byte) => byte !== 0));
  const positive = (withoutZeroes[0] ?? 0) >= 0x80 ? [0, ...withoutZeroes] : withoutZeroes;
  return [0x02, positive.length, ...positive];
};

const p1363ToDer = (raw: Uint8Array): Uint8Array => {
  const integers = [...scalarDer(raw.slice(0, 32)), ...scalarDer(raw.slice(32))];
  return Uint8Array.from([0x30, integers.length, ...integers]);
};

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const signedFixture = async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const generatedAt = "2026-08-28T12:00:00.000Z";
  const payload = {
    chainId: "SN_MAIN",
    completeness: { completeFromDeployment: true, deploymentBlock: 1 },
    generatedAt,
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
    snapshotBlockHash: "0xabc",
    snapshotBlockNumber: 100,
    withdrawals: [
      {
        ...scoreRow(),
        asOfBlock: 100,
        eventId: "0xabc:4",
        maxProbability: 0.2,
        score: 72.25,
      },
    ],
  };
  const payloadBytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", payloadBytes)));
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign({ hash: "SHA-256", name: "ECDSA" }, keys.privateKey, payloadBytes),
  );
  const signature = {
    algorithm: "ECDSA_SHA_256",
    keyId: PRIVACY_SCORE_KEY_ID,
    value: base64(p1363ToDer(rawSignature)),
  };
  const envelopeInput = { payload, payloadSha256: digest, signature };
  const manifestInput = {
    generatedAt,
    payloadSha256: digest,
    schemaVersion: 1,
    signature,
    snapshotBlockHash: payload.snapshotBlockHash,
    snapshotBlockNumber: payload.snapshotBlockNumber,
    snapshotKey: `v1/snapshots/100-0000000000000abc-${digest.slice(0, 16)}.json.gz`,
  };
  const envelope = readPrivacyScoreEnvelope(envelopeInput);
  const manifest = readPrivacyScoreManifest(manifestInput);
  if (!envelope || !manifest) {
    throw new Error("test fixture did not satisfy the production schema");
  }
  return {
    envelope,
    envelopeInput,
    manifest,
    trust: {
      fingerprint: bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", publicKey))),
      publicKeyDerBase64: base64(publicKey),
    },
  };
};

describe("privacy score verification", () => {
  test("verifies canonical payloads with a pinned P-256 key", async () => {
    const fixture = await signedFixture();

    expect(
      await verifyPrivacyScoreEnvelope(fixture.envelope, fixture.manifest, fixture.trust),
    ).toBe(true);
  });

  test("rejects tampering and non-canonical DER", async () => {
    const fixture = await signedFixture();
    const tamperedInput = structuredClone(fixture.envelopeInput);
    const [firstWithdrawal] = tamperedInput.payload.withdrawals;
    if (!firstWithdrawal) {
      throw new Error("test fixture lost its withdrawal");
    }
    firstWithdrawal.score = 99;
    const tampered = readPrivacyScoreEnvelope(tamperedInput);
    if (!tampered) {
      throw new Error("tampered fixture should remain structurally valid");
    }

    expect(await verifyPrivacyScoreEnvelope(tampered, fixture.manifest, fixture.trust)).toBe(false);
    expect(privacyScoreDerToP1363(Uint8Array.from([0x30, 3, 0x02, 1, 0]))).toBeNull();
  });
});

describe("privacy score association", () => {
  test("uses the lowest locally matched score and exposes its evidence", () => {
    const result = summarizePrivacyScores(
      [
        scoreRow(),
        scoreRow({
          candidateCount: 5,
          confidence: "medium",
          effectiveAnonymitySet: 3,
          eventId: `${HASH_TWO}:7`,
          factors: ["dominant exact amount match"],
          score: 25,
          transactionHash: HASH_TWO,
        }),
      ],
      [{ hash: HASH_ONE }, { hash: HASH_TWO }],
      { generatedAt: "2026-08-28T12:00:00.000Z", snapshotBlockNumber: 100 },
    );

    expect(result).toMatchObject({
      candidateCount: 5,
      factors: ["dominant exact amount match"],
      matchedWithdrawals: 2,
      maximumScore: 72,
      medianScore: 48.5,
      score: 25,
      status: "available",
    });
  });

  test("never guesses inside a multi-withdrawal transaction", () => {
    const transactions = [{ hash: HASH_ONE }];
    const snapshot = { generatedAt: "2026-08-28T12:00:00.000Z", snapshotBlockNumber: 100 };

    expect(
      summarizePrivacyScores(
        [scoreRow(), scoreRow({ eventId: `${HASH_ONE}:8` })],
        transactions,
        snapshot,
      ),
    ).toEqual({ status: "unavailable" });
    expect(
      summarizePrivacyScores(
        [
          scoreRow(),
          scoreRow({ eventId: `${HASH_ONE}:8` }),
          scoreRow({ eventId: `${HASH_TWO}:1`, transactionHash: HASH_TWO }),
        ],
        [...transactions, { hash: HASH_TWO }],
        snapshot,
      ),
    ).toEqual({ status: "unavailable" });
    expect(summarizePrivacyScores([], transactions, snapshot)).toEqual({ status: "pending" });
  });
});
