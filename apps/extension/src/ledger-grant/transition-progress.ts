/**
 * User-visible progress copy for the Ledger management transition. Keeping the
 * mapping exhaustive makes every protocol phase visible without coupling the
 * deterministic state machine to the grant tab's DOM.
 *
 * The title carries the phase; a message is added only where the reader has
 * something to do. The one device prompt also says nothing is signed,
 * because a Ledger asking for approval otherwise reads as a request to sign. Every phase used to narrate what the wallet was doing to
 * the device, which said the title again in more words and made a handshake
 * look like seven events instead of one wait.
 */

import type { LedgerTransitionPhase } from "@bramble/ledger-protocol/device-transition";

/**
 * Fixed non-sensitive copy rendered for one Ledger transition phase.
 */
export type LedgerTransitionProgress = {
  /** Empty unless this phase needs an action from the reader. */
  readonly message: string;
  readonly title: string;
};

const PROGRESS: Readonly<Record<LedgerTransitionPhase, LedgerTransitionProgress>> = {
  "checking-device": { message: "", title: "Checking your Ledger" },
  "returning-to-dashboard": { message: "", title: "Returning to the dashboard" },
  "reconnecting-dashboard": { message: "", title: "Reconnecting to your Ledger" },
  "checking-firmware": { message: "", title: "Checking Ledger firmware" },
  "opening-starknet": {
    message: "Confirm the prompt on your Ledger. No transaction is signed.",
    title: "Approve opening Starknet",
  },
  "reconnecting-starknet": { message: "", title: "Starknet is opening" },
  "confirming-starknet": { message: "", title: "Confirming Starknet" },
};

/**
 * Returns fixed, non-sensitive progress copy for one Ledger transition phase.
 */
export const ledgerTransitionProgress = (phase: LedgerTransitionPhase): LedgerTransitionProgress =>
  PROGRESS[phase];
