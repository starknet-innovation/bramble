/**
 * User-visible progress copy for the Ledger management transition. Keeping the
 * mapping exhaustive makes every protocol phase visible without coupling the
 * deterministic state machine to the grant tab's DOM.
 */

import type { LedgerTransitionPhase } from "@bramble/ledger-protocol/device-transition";

/**
 * Fixed non-sensitive copy rendered for one Ledger transition phase.
 */
export type LedgerTransitionProgress = {
  readonly message: string;
  readonly title: string;
};

const PROGRESS: Readonly<Record<LedgerTransitionPhase, LedgerTransitionProgress>> = {
  "checking-device": {
    message: "MC Wallet is confirming which app is open. Nothing is signed.",
    title: "Checking Ledger state",
  },
  "returning-to-dashboard": {
    message: "MC Wallet is returning the device to its dashboard before reading firmware.",
    title: "Preparing firmware check",
  },
  "reconnecting-dashboard": {
    message: "MC Wallet is reconnecting to the same device and confirming its dashboard.",
    title: "Reconnecting to your Ledger",
  },
  "checking-firmware": {
    message: "MC Wallet is validating the device model and installed OS version.",
    title: "Checking Ledger firmware",
  },
  "opening-starknet": {
    message: "Confirm the app-open prompt on your Ledger. No transaction is being signed.",
    title: "Approve opening Starknet",
  },
  "reconnecting-starknet": {
    message: "MC Wallet is reconnecting to the same device after the app transition.",
    title: "Starknet is opening",
  },
  "confirming-starknet": {
    message: "MC Wallet is verifying the app before reading a public account key.",
    title: "Confirming Starknet",
  },
};

/**
 * Returns fixed, non-sensitive progress copy for one Ledger transition phase.
 */
export const ledgerTransitionProgress = (phase: LedgerTransitionPhase): LedgerTransitionProgress =>
  PROGRESS[phase];
