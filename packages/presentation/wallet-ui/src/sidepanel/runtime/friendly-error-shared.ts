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

/** Shared ending for an account that was not added (add, create, or import). */
export const ADD_ACCOUNT_FAILED = "Couldn't add that account. Try again.";

/**
 * True for the refusal `wallet.addAccount` returns when the vault was set up
 * from a Ledger or a pasted key and so holds no phrase to derive from.
 */
export const isPhraselessAddRefusal = (raw: string): boolean =>
  raw.trim().toLowerCase() === "no recovery phrase stored for this wallet";

/** Shared ending for a recovery phrase the wallet could not import. */
export const SEED_IMPORT_FAILED =
  "Couldn't import that recovery phrase. Check the words and try again.";

/** Shared ending for a pasted private key the wallet could not import. */
export const KEY_IMPORT_FAILED =
  "Couldn't import that account. Check what you pasted and try again.";

/** An account whose contract class this wallet does not recognize, by home wallet. */
export const UNRECOGNIZED_RELEASE = {
  braavos: "This account runs a release this wallet doesn't recognize. Use it in Braavos.",
  ready: "This account runs a release this wallet doesn't recognize. Use it in Ready.",
} as const;

/** Shared ending for a swap the wallet refused to build because a safety check failed. */
export const SWAP_ROUTE_UNSAFE = "Couldn't prepare a safe route for this swap. Get a fresh quote.";

/** Shared ending for a review whose subject changed while the reader read it. */
export const REVIEW_MOVED = "This changed while you were reviewing it. Review it again.";

/** A review whose prepared commitment no longer matches what the reader reviewed. */
export const PREPARATION_MISMATCH =
  "This review no longer matches what was prepared. Review it again.";

/** Shared ending for a backup file the wallet could not read. */
export const BACKUP_UNREADABLE = "Couldn't read that backup file. Check the file and try again.";

/**
 * A private action refused because it would link the reader's identity. The
 * wallet's own words for this refusal to sites (rpc-errors PRIVACY_LEAK).
 */
export const PRIVACY_LEAK = "The operation would leak private information";

/** Shown when an endpoint reports another Starknet chain than the account's. */
export const WRONG_CHAIN_ENDPOINT =
  "That endpoint reports a different Starknet chain, so nothing was submitted. Check the endpoint under Network → Advanced.";

/** Shown when the encrypted store cannot be verified. */
export const VAULT_UNVERIFIED = "Bramble cannot verify this wallet. Close and reopen Bramble.";
