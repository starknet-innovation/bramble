/**
 * The staking overview the background returns to extension pages: display
 * strings only. Amounts are formatted in the token's own decimals by the
 * background; the panel never derives an address, a pool or calldata from it.
 */
import type { StakingPositionState } from "@bramble/transactions/staking-calls";

/**
 * One validator and token row. `refusal` replaces the figures when the pool
 * could not be verified on chain, and the row offers no action.
 */
export type StakingRowView = {
  /** Commission in percent, e.g. "10%". */
  readonly commission?: string;
  /** Total delegated to this pool, formatted. */
  readonly delegated?: string;
  /** False while the validator is leaving: no new stake, exits still work. */
  readonly accepting?: boolean;
  readonly refusal?: string;
  /** The account's staked amount, formatted ("0" when not a member). */
  readonly staked?: string;
  readonly state?: StakingPositionState;
  readonly symbol: string;
  readonly tokenId: string;
  /** Unclaimed rewards, formatted. */
  readonly unclaimed?: string;
  /** Amount waiting out the exit window, formatted. */
  readonly unpoolAmount?: string;
  /** Unix seconds the pending exit becomes withdrawable. */
  readonly unpoolTime?: number;
  readonly validatorId: string;
  readonly validatorName: string;
};

/**
 * The whole staking screen for the active account and network.
 */
type StakingOverview = {
  /** Seconds an unstake waits, read from the staking contract. */
  readonly exitWindowSeconds: number;
  readonly rows: readonly StakingRowView[];
};

/**
 * `wallet.stakingOverview` success.
 */
export type StakingOverviewResponse = {
  readonly ok: true;
  readonly staking: StakingOverview;
};
