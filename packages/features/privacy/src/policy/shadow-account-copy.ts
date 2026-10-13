/**
 * PROPOSED copy for the shadow-account approval card (#443, PR 4). Every value
 * is the issue's wording, or an existing approved pattern where the issue has
 * none, and is pending copy review: change the text here, one line per
 * constant, and the card and its tests follow.
 *
 * These are approval sentences, so they are edited against "did we lose a
 * fact?" (docs/COPY_STYLE.md), never shortened for length.
 */

/** What runs, through which shadow account, for which site. Issue wording. */
export const SHADOW_INVOKE_RUNS = (calls: number, nonce: string, origin: string): string =>
  `Runs ${calls} call${calls === 1 ? "" : "s"} through your shadow account #${nonce} for ${origin}`;

/** The configured anonymizer the calls run through. Mirrors "Privacy pool <address>". */
export const SHADOW_INVOKE_ANONYMIZER = (address: string): string =>
  `Shadow account anonymizer ${address}`;

/** The tokens the invoke settles back into private notes. Issue wording. */
export const SHADOW_INVOKE_SETTLES = (tokens: string): string =>
  `Settles ${tokens} back into private notes`;

/**
 * The tokens the invoke settles into a private note for someone other than
 * this account. PROPOSED; mirrors "Transfer … privately to <address>".
 */
export const SHADOW_INVOKE_SETTLES_TO = (tokens: string, recipient: string): string =>
  `Settles ${tokens} into a private note for ${recipient}`;

/**
 * `collect_policy: all` with an OPEN note for someone other than this account:
 * the shadow account's whole balance of those tokens goes to them, including
 * what earlier calls left behind. PROPOSED.
 */
export const SHADOW_INVOKE_COLLECTS_ALL_TO = (tokens: string, recipient: string): string =>
  `This shadow account's whole ${tokens} balance goes to ${recipient}`;

/** No OPEN transfer in the batch: nothing returns to the private balance. Issue wording, negated. */
export const SHADOW_INVOKE_SETTLES_NOTHING = "Nothing settles back into private notes";

/** Who can move what the calls leave behind. Issue wording. */
export const SHADOW_INVOKE_CONTROL =
  "Whatever the calls leave in the shadow account can only be moved by this wallet on this site";

/** The sweep review's first line (#443, PR 5). PROPOSED; mirrors SHADOW_INVOKE_RUNS. */
export const SHADOW_SWEEP_SUMMARY = (nonce: string, origin: string): string =>
  `Sweep your shadow account #${nonce} for ${origin}`;

/**
 * The activity line a settled sweep records. PROPOSED. Activity summaries are
 * data (dedup guards match on them), so this is fixed before it first ships.
 */
export const SHADOW_SWEEP_ACTIVITY = (nonce: string, origin: string): string =>
  `Sweep shadow account #${nonce} for ${origin}`;
