/**
 * SCHEMA-DERIVED staking directory fixtures, NOT a live capture.
 *
 * Hand-built from Starkscan's published OpenAPI schemas `StakingValidatorPage`,
 * `StakingValidator`, `StakingPool`, `StakingTokenAmount`, `StakingRatio` and
 * `StakingCoverage` (read 2026-11-06). Live replies can differ from a schema,
 * for example `null` against an absent field (PR 850), so these must be
 * replaced or joined by a verbatim capture once the gateway route and its
 * Starkscan key exist. Every required key is present, with the schema's
 * `null` where a figure is unavailable.
 */
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";

/** A stand-in second token (not a real address) for multi-token cases. */
export const DIRECTORY_BTC_TOKEN = "0xb7c";

const ratio = (numerator: string, denominator: string) => ({
  denominatorRaw: denominator,
  numeratorRaw: numerator,
});

const pool = (tokenAddress: string, address: string, status = "active") => ({
  address,
  commission: ratio("1000", "10000"),
  generationRaw: "1",
  hhi: null,
  metricValueReason: null,
  status,
  tokenAddress,
  top1Share: null,
  top5Share: null,
});

const stake = (tokenAddress: string, delegatedStakeRaw: string | null) => ({
  decimals: 18,
  delegatedStakeRaw,
  metricValueReason: null,
  networkShare: null,
  pendingExitRaw: "0",
  selfStakeRaw: "0",
  symbol: "STRK",
  tokenAddress,
  totalStakeRaw: delegatedStakeRaw,
});

/** One `StakingValidator` with every required key; override any of them. */
export const directoryValidator = (
  address: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  address,
  attestationDelay30d: null,
  attestationDelay7d: null,
  attestationDelay90d: null,
  commission: ratio("500", "10000"),
  currentEpoch: null,
  delegatorCount: 12,
  lastAttestationEpochRaw: "100",
  liveness30d: ratio("995", "1000"),
  liveness30dFirstEpoch: 1,
  liveness30dLastEpoch: 100,
  liveness30dReasonCode: null,
  liveness7d: null,
  liveness7dFirstEpoch: null,
  liveness7dLastEpoch: null,
  liveness7dReasonCode: null,
  liveness90d: null,
  liveness90dFirstEpoch: null,
  liveness90dLastEpoch: null,
  liveness90dReasonCode: null,
  livenessCoverageFromEpoch: 1,
  livenessRevision: 1,
  longestMissedStreak90d: 0,
  metricValueReason: null,
  missedStreak: 0,
  name: "Validator One",
  operationalAddress: null,
  pools: [pool(STRK_TOKEN_ADDRESS, "0x5a3")],
  protocolSlug: null,
  rewardAddress: null,
  rewards: [],
  stake: [stake(STRK_TOKEN_ADDRESS, "1500000000000000000000")],
  status: "active",
  validatorGenerationId: `sha256:${"a".repeat(64)}`,
  website: "https://validator.example/about",
  ...overrides,
});

/** Builders for the nested items, for tests that vary one pool or stake. */
export const directoryParts = { pool, ratio, stake };

/** One `StakingValidatorPage`; override any top-level key. */
export const directoryPage = (
  items: readonly unknown[],
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  chainId: "SN_MAIN",
  coverage: {
    activityHistoryTruncated: false,
    finalizedOnly: true,
    gapIntervals: [],
    lagBlocks: 0,
    lastSuccessfulRunAtIso: "2026-11-06T00:00:00Z",
    materializedThroughBlock: 100,
    materializedThroughHash: "0x1",
    metricDefinitionVersion: "1",
    outstandingMaterializationIntervals: [],
    reasonCode: "ok",
    sourceLatestFinalizedBlock: 100,
    status: "prepared",
  },
  items,
  nextCursor: null,
  source: "finalized_prepared_staking_snapshot",
  ...overrides,
});
