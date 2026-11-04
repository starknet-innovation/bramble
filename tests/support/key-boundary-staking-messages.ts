/** Staking requests included in the exhaustive background message scan. */
import { extensionSender, KEY_BOUNDARY_TOKENS } from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";
import { VALIDATOR_ID } from "./staking-chain";

/** Live staking requests: the overview, and a stake through its fee review. */
export const STAKING_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.stakingOverview" }, sender: extensionSender },
  {
    message: {
      action: "stake",
      amount: "1",
      tokenId: KEY_BOUNDARY_TOKENS.strk.id,
      type: "wallet.stakingAction",
      validatorId: VALIDATOR_ID,
    },
    sender: extensionSender,
  },
];
