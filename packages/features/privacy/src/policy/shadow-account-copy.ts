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

/** No OPEN transfer in the batch: nothing returns to the private balance. Issue wording, negated. */
export const SHADOW_INVOKE_SETTLES_NOTHING = "Nothing settles back into private notes";

/** Who can move what the calls leave behind. Issue wording. */
export const SHADOW_INVOKE_CONTROL =
  "Whatever the calls leave in the shadow account can only be moved by this wallet on this site";
