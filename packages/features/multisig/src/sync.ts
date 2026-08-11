/**
 * Safe, non-secret multisig refresh diagnostics shared across the privileged
 * background boundary and the extension UI. These values describe which
 * best-effort proposal lane degraded without exposing RPC URLs or raw provider
 * errors.
 */

/**
 * Proposal-refresh conditions that do not invalidate fresh contract config.
 */
export const MULTISIG_SYNC_WARNINGS = [
  "proposal-discovery-recent",
  "proposal-discovery-unavailable",
  "proposal-refresh-incomplete",
] as const;

/**
 * One bounded, user-actionable proposal refresh warning.
 */
export type MultisigSyncWarning = (typeof MULTISIG_SYNC_WARNINGS)[number];

/**
 * Validates a warning received across the extension message boundary.
 */
export const isMultisigSyncWarning = (value: unknown): value is MultisigSyncWarning =>
  typeof value === "string" && MULTISIG_SYNC_WARNINGS.some((warning) => warning === value);
