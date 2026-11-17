/** Staking requests included in the exhaustive background message scan. */
import { extensionSender, KEY_BOUNDARY_TOKENS } from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";
import { STAKER } from "./staking-chain";

/** The prepare request the scan sends, and the harness reuses for a live id. */
export const STAKING_PREPARE_MESSAGE = {
  action: "stake",
  amount: "1",
  staker: STAKER,
  tokenId: KEY_BOUNDARY_TOKENS.strk.id,
  type: "wallet.stakingPrepare",
} as const;

/**
 * Live staking requests: the directory (no route, so "off"), one staker's
 * overview, a prepare, and its one-time confirm.
 */
export const STAKING_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.stakingDirectory" }, sender: extensionSender },
  { message: { type: "wallet.stakingPositions" }, sender: extensionSender },
  { message: { staker: STAKER, type: "wallet.stakingOverview" }, sender: extensionSender },
  { message: { ...STAKING_PREPARE_MESSAGE }, sender: extensionSender },
  {
    live: async (ids) => ({ preparationId: await ids.stakingPreparationId() }),
    message: { preparationId: "", type: "wallet.stakingExecute" },
    sender: extensionSender,
  },
];
