/**
 * Shared sentence endings used by more than one error-copy table, split to a
 * leaf module so the tables can both import them without a cycle. A failure
 * the reader cannot diagnose gets the same sentence wherever it comes from.
 */

/** Shared ending for a change that did not persist. */
export const SAVE_FAILED = "Couldn't save that change. Try again.";

/** Shared ending for a submission whose result the wallet cannot know. */
export const OUTCOME_UNKNOWN = "The result is unknown. Check Activity before trying again.";

/** Shared catch-all around a submission; never claims failure or invites a double send. */
export const SUBMISSION_UNKNOWN = (what: string): string =>
  `${what} may not have gone through. Check Activity before trying again.`;
