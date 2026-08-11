/**
 * Multisig refresh health shown by the side panel. Contract configuration is
 * authoritative; proposal discovery and tracked-proposal reads are separate
 * best-effort lanes so one degraded RPC capability never mislabels the whole
 * account as stale.
 */
import type { MultisigSyncWarning } from "@mc-wallet/multisig/sync";

/**
 * Current refresh health for the selected multisig portfolio.
 */
export type MultisigSyncState =
  | "current"
  | MultisigSyncWarning
  | "configuration-unavailable"
  | "background-unavailable"
  | null;

const PRIORITY: readonly Exclude<MultisigSyncState, "current" | null>[] = [
  "configuration-unavailable",
  "background-unavailable",
  "proposal-refresh-incomplete",
  "proposal-discovery-unavailable",
  "proposal-discovery-recent",
];

/**
 * Resolves several watched-account outcomes to the most actionable status.
 */
export const mostImportantMultisigSync = (
  states: readonly Exclude<MultisigSyncState, null>[],
): Exclude<MultisigSyncState, null> =>
  PRIORITY.find((candidate) => states.some((state) => state === candidate)) ?? "current";

/**
 * Stable action result copy for a manual refresh.
 */
export const multisigSyncActionMessage = (state: Exclude<MultisigSyncState, null>): string => {
  switch (state) {
    case "current":
      return "Multisig state refreshed";
    case "proposal-discovery-recent":
      return "State refreshed; proposal search covers recent activity";
    case "proposal-discovery-unavailable":
      return "State refreshed; automatic proposal search is unavailable";
    case "proposal-refresh-incomplete":
      return "Configuration refreshed; some proposal statuses remain cached";
    case "configuration-unavailable":
      return "Could not read this multisig's configuration from the selected network";
    case "background-unavailable":
      return "The wallet background did not complete the multisig refresh";
  }
};

/**
 * Whether a refresh state means authoritative contract config is unavailable.
 */
export const isMultisigSyncFailure = (state: Exclude<MultisigSyncState, null>): boolean =>
  state === "configuration-unavailable" || state === "background-unavailable";
