/**
 * Stable error codes for the wallet's own shadow-account refusals (#443,
 * PR 5): the Shadow accounts view, its reads, and the sweep. Each is a
 * `WalletError` message the panel receives; none is dapp-facing (record errors
 * reach a site only through the generic STRK20 mapping).
 *
 * The values are codes, not copy. They are pinned by a test so the panel's
 * curated error copy can map each with one entry; the user-facing sentences
 * for them are pending copy review. The vault's own record refusals live
 * beside the records, in `@bramble/vault/shadow-account-scopes`. Each is a
 * top-level string constant thrown as `new WalletError(NAME)`, the shape the
 * conformance error scan reads.
 */

/** The scope is recorded only under an anonymizer the network no longer uses. */
export const SHADOW_ACCOUNT_ANONYMIZER_CHANGED = "shadow account anonymizer changed";

/** The shadow account holds none of the tracked tokens, so there is nothing to sweep. */
export const SHADOW_ACCOUNT_HOLDS_NO_TRACKED_TOKEN = "shadow account holds no tracked token";

/** The vault cannot list or record scopes, or the service cannot read them. */
export const SHADOW_ACCOUNT_RECORDS_UNAVAILABLE = "shadow account records unavailable";

/** No record names this site and label, or the nonce is neither recorded nor scanned. */
export const SHADOW_ACCOUNT_SCOPE_NOT_RECORDED = "shadow account scope not recorded";

/** The wallet-built sweep batch fails a pre-approval batch rule; nothing was sent. */
export const SHADOW_SWEEP_BREAKS_BATCH_RULE = "shadow sweep batch breaks a batch rule";
