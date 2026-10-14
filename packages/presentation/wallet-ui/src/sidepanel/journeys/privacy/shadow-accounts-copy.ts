/**
 * PROPOSED copy for the Shadow accounts view and sweep (issue 443, PR 5), pending
 * copy review. One constant per line. The reason line carries the issue's
 * required disclosure: balances are read only on request because the reads
 * link these addresses at the RPC provider.
 */

/** Settings row and view title. */
export const SHADOW_ACCOUNTS_TITLE = "Shadow accounts";

/** Why balances wait for a tap. Issue wording, as one sentence. */
export const SHADOW_ACCOUNTS_READ_REASON =
  "Balances are read only when you ask, because the reads link these addresses at your RPC provider.";

/** Empty state: no scope recorded for this account, network, and pool. */
export const SHADOW_ACCOUNTS_EMPTY = "No shadow accounts yet.";

/** A scope recorded under an anonymizer the network no longer uses. */
export const SHADOW_ACCOUNTS_OTHER_ANONYMIZER = (address: string): string =>
  `Recorded under another anonymizer, ${address}. This wallet cannot reach it on the current one.`;

/** The per-scope network read. */
export const SHADOW_ACCOUNTS_CHECK = "Check balances";

/** A shadow account with nothing the wallet tracks. */
export const SHADOW_ACCOUNTS_NOTHING_HELD = "No tracked tokens";

/** A listed shadow account not yet deployed (it may still hold funds). */
export const SHADOW_ACCOUNTS_UNDEPLOYED = "Not deployed";

/** Recorded nonces the anonymizer's view cannot list. */
export const SHADOW_ACCOUNTS_UNLISTED = (nonces: string): string =>
  `Not listable through the anonymizer: #${nonces}`;

/** The sweep control. */
export const SHADOW_ACCOUNTS_SWEEP = "Sweep";

/** The sweep's confirmation, after its review is shown. */
export const SHADOW_ACCOUNTS_CONFIRM_SWEEP = "Confirm sweep";

/** After the relay accepted the sweep. */
export const SHADOW_ACCOUNTS_SWEEP_SENT = "Sweep submitted. Follow it in Activity.";

/** While the records load from the vault. Mirrors "Loading allowances…". */
export const SHADOW_ACCOUNTS_LOADING = "Loading shadow accounts…";
