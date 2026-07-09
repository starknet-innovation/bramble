/**
 * Vesu integration stub — lending (earn/borrow). Phase-2 fills these in:
 * `quoteLending` resolves pool config from the Vesu API (VESU_API_BASE) —
 * singleton via `singleton()` on the extension, vToken per collateral asset —
 * and projects the position; `buildLendingCalls` assembles the documented
 * multicalls for the in-wallet invoke path (earn: approve -> vToken.deposit
 * (ERC-4626); borrow/repay: approve -> singleton.modify_position with i257
 * signed amounts). No external SDK.
 */
import type { Call } from "starknet";
import { WalletError } from "../../shared/errors";
import type { LendingParams, LendingQuote, LendingQuoteParams } from "./types";

/**
 * Vesu protocol id for tagging quotes and routing.
 */
export const VESU_PROTOCOL_ID = "vesu" as const;

/**
 * Resolves pool addresses and projects a lending position. TODO(phase2).
 */
export const quoteLending = (_params: LendingQuoteParams): Promise<LendingQuote> => {
  // TODO(phase2): GET {VESU_API_BASE}/pools/{poolId}, resolve extension ->
  // singleton() and the per-asset vToken address, then fill supply/borrow APY
  // into a LendingQuote.
  throw new WalletError("vesu quoteLending not implemented");
};

/**
 * Builds the Vesu lending multicall for a quoted action. TODO(phase2).
 */
export const buildLendingCalls = (_params: LendingParams): readonly Call[] => {
  // TODO(phase2): supply/withdraw -> [approve(vToken), vToken.deposit|withdraw];
  // borrow/repay -> [approve, singleton.modify_position] with toI257 signed
  // amounts, built with CallData.compile + cairo.uint256.
  throw new WalletError("vesu buildLendingCalls not implemented");
};
