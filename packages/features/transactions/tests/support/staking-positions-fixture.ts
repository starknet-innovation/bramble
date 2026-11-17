/**
 * SCHEMA-DERIVED staking positions fixtures, NOT a live capture.
 *
 * Hand-built from Starkscan's published OpenAPI schemas `StakingAddressView`,
 * `StakingDelegator`, `StakingRatio` and `StakingCoverage` for
 * `GET /v1/{chain}/staking/address/{address}` (read 2026-11-06). Live replies
 * can differ from a schema, for example `null` against an absent field
 * (PR 850), so these must be replaced or joined by a verbatim capture (a
 * plain read-only GET) before release. Every required key is present.
 */
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { directoryPage } from "./staking-directory-fixture";

/** One `StakingDelegator` for `address`; override any key. */
export const position = (
  address: string,
  validatorAddress: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  address,
  delegatedRaw: "5000000000000000000",
  exitEligibilityReasonCode: "not_applicable",
  exitEligibleAtIso: null,
  exitIntentTransactionHash: null,
  pendingExitRaw: null,
  poolAddress: "0x5a3",
  share: { denominatorRaw: "1000", numeratorRaw: "5" },
  status: "active",
  tokenAddress: STRK_TOKEN_ADDRESS,
  validatorAddress,
  validatorGenerationId: `sha256:${"a".repeat(64)}`,
  ...overrides,
});

/** One `StakingAddressView` for `address`; override any top-level key. */
export const positionsView = (
  address: string,
  positions: readonly unknown[],
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  address,
  chainId: "SN_MAIN",
  coverage: directoryPage([])["coverage"],
  history: [],
  nextHistoryCursor: null,
  positions,
  positionsTruncated: false,
  source: "finalized_prepared_staking_snapshot",
  ...overrides,
});
