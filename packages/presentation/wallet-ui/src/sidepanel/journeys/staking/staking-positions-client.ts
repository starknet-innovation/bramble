/**
 * "Your stakes" on the staking screen (issue 750): the active account's
 * positions the background confirmed on chain after Starkscan listed them.
 * The reply is re-validated key by key with the same row check as a
 * validator's own screen; it is display data only, and opening a row reads
 * that validator again on chain.
 *
 * Failure behaviour: no route is "off" (the section is absent); a refusal or
 * an unrecognised reply is "unavailable" with a short line, never an empty
 * list. `complete: false` keeps whatever was confirmed and says the list may
 * be missing something.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { MAX_CHECKED_POSITIONS } from "@bramble/transactions/staking-positions";
import { refusalText } from "../../runtime/runtime-errors";
import { isStakingRow, type StakingRow } from "./staking-client";

const UNREADABLE = "Couldn't load your stakes.";

/** "Your stakes": loading, no route, unreadable, or the confirmed rows. */
export type StakingPositionsState =
  | { readonly loading: true }
  | { readonly off: true }
  | { readonly unavailable: string }
  | { readonly complete: boolean; readonly rows: readonly StakingRow[] };

/**
 * Reads a `wallet.stakingPositions` reply. A refusal keeps the background's
 * sentence; anything unrecognised reads as unavailable, never as empty.
 */
export const stakingPositionsFrom = (response: unknown): StakingPositionsState => {
  const positions = isRecord(response) ? response["stakingPositions"] : undefined;
  if (
    !isRecord(response) ||
    !hasOnlyKnownKeys(response, ["ok", "stakingPositions"]) ||
    response["ok"] !== true ||
    !isRecord(positions)
  ) {
    return { unavailable: refusalText(response, UNREADABLE) };
  }
  if (positions["state"] === "off" && hasOnlyKnownKeys(positions, ["state"])) return { off: true };
  const rows = positions["rows"];
  return positions["state"] === "ready" &&
    hasOnlyKnownKeys(positions, ["complete", "rows", "state"]) &&
    typeof positions["complete"] === "boolean" &&
    Array.isArray(rows) &&
    rows.length <= MAX_CHECKED_POSITIONS &&
    rows.every((row) => isStakingRow(row) && row.refusal === undefined)
    ? { complete: positions["complete"], rows }
    : { unavailable: UNREADABLE };
};

/**
 * Creates the "Your stakes" half of the staking client over the panel's sender.
 */
export const createStakingPositionsRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  /** The active account's positions, each confirmed on chain. */
  async loadStakingPositions(): Promise<StakingPositionsState> {
    return stakingPositionsFrom(
      await sendMessage({ type: "wallet.stakingPositions" }).catch(() => null),
    );
  },
});
