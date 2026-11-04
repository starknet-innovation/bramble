/** Staking requests included in the exhaustive background message scan. */
import { extensionSender, KEY_BOUNDARY_TOKENS } from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";
import { VALIDATOR_ID } from "./staking-chain";

/** The prepare request the scan sends, and the harness reuses for a live id. */
export const STAKING_PREPARE_MESSAGE = {
  action: "stake",
  amount: "1",
  tokenId: KEY_BOUNDARY_TOKENS.strk.id,
  type: "wallet.stakingPrepare",
  validatorId: VALIDATOR_ID,
} as const;

/** Live staking requests: the overview, a prepare, and its one-time confirm. */
export const STAKING_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.stakingOverview" }, sender: extensionSender },
  { message: { ...STAKING_PREPARE_MESSAGE }, sender: extensionSender },
  {
    live: async (ids) => ({ preparationId: await ids.stakingPreparationId() }),
    message: { preparationId: "", type: "wallet.stakingExecute" },
    sender: extensionSender,
  },
];
