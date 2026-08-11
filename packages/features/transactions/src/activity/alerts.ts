/**
 * Maximum late transaction notices returned by one background drain. Keeping
 * the batch small bounds extension-message and toast work while leaving later
 * notices queued for the next refresh.
 */
export const MAX_TRANSACTION_ALERTS_PER_DRAIN = 5;

/**
 * Maximum accepted length for one late transaction notice crossing the
 * background-to-panel boundary.
 */
export const MAX_TRANSACTION_ALERT_CHARACTERS = 512;
