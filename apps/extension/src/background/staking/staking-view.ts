/**
 * The staking overview the background returns to extension pages: display
 * strings only. Amounts are formatted in the token's own decimals by the
 * background; the panel never derives an address, a pool or calldata from it.
 */
import type { StakingPositionState } from "@bramble/transactions/staking-calls";
import type { StakingDirectoryEntry } from "@bramble/transactions/staking-directory";

/**
 * One token row for the chosen staker. `refusal` replaces the figures when
 * the pool could not be verified on chain, and the row offers no action.
 */
export type StakingRowView = {
  /** Commission in percent, e.g. "10%". */
  readonly commission?: string;
  /** Total delegated to this pool, formatted. */
  readonly delegated?: string;
  /** False while the validator is leaving: no new stake, exits still work. */
  readonly accepting?: boolean;
  readonly refusal?: string;
  /** The token rewards are paid in (STRK for every pool). */
  readonly rewardSymbol?: string;
  /** The membership's reward address when it is not this account. */
  readonly rewardsTo?: string;
  /** The account's staked amount, formatted ("0" when not a member). */
  readonly staked?: string;
  /** The canonical staker address the row was read and verified for. */
  readonly staker: string;
  readonly state?: StakingPositionState;
  readonly symbol: string;
  readonly tokenId: string;
  /** Unclaimed rewards, formatted. */
  readonly unclaimed?: string;
  /** Amount waiting out the exit window, formatted. */
  readonly unpoolAmount?: string;
  /** Unix seconds the pending exit becomes withdrawable. */
  readonly unpoolTime?: number;
};

/**
 * One staker's pools for the active account and network.
 */
type StakingOverview = {
  /** Seconds an unstake waits, read from the staking contract. */
  readonly exitWindowSeconds: number;
  readonly rows: readonly StakingRowView[];
};

/**
 * `wallet.stakingOverview` success.
 */
type StakingOverviewResponse = {
  readonly ok: true;
  readonly staking: StakingOverview;
};

/**
 * What `wallet.stakingDirectory` answers: no route ("off"), a snapshot that
 * Starkscan reports as incomplete (no validators offered), or one page.
 */
export type StakingDirectoryView =
  | { readonly state: "incomplete" | "off" }
  | {
      readonly entries: readonly StakingDirectoryEntry[];
      readonly nextCursor: string | null;
      readonly state: "ready";
    };

/**
 * `wallet.stakingDirectory` success.
 */
type StakingDirectoryResponse = {
  readonly ok: true;
  readonly stakingDirectory: StakingDirectoryView;
};

/**
 * What `wallet.stakingPositions` answers: no route ("off"), or the account's
 * positions that the chain confirmed. `complete` is false whenever Starkscan's
 * list was incomplete or truncated, or a listed position could not be checked;
 * the screen then never reads an empty list as "no stakes".
 */
export type StakingPositionsView =
  | { readonly state: "off" }
  | {
      readonly complete: boolean;
      readonly rows: readonly StakingRowView[];
      readonly state: "ready";
    };

/**
 * `wallet.stakingPositions` success.
 */
type StakingPositionsResponse = {
  readonly ok: true;
  readonly stakingPositions: StakingPositionsView;
};

/** Every read-only staking success the background answers. */
export type StakingResponse =
  | StakingDirectoryResponse
  | StakingOverviewResponse
  | StakingPositionsResponse;
