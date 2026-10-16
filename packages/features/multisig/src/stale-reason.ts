/**
 * Why a multisig intent went stale (mc-wallet 673). Recorded locally only:
 * the shared intent package leaves it out, so co-signers on older builds keep
 * accepting the package, and an imported intent never inherits a remote claim.
 */

/**
 * `fee` when the node refused this version's signed fee while the account
 * nonce was still the one it was signed for; `nonce` when that nonce moved, so
 * a co-signer may have sent it; `config` when the signer set changed.
 */
export type ArgentMultisigStaleReason = "config" | "fee" | "nonce";

/** True for a known stale reason. */
export const isArgentMultisigStaleReason = (value: unknown): value is ArgentMultisigStaleReason =>
  value === "config" || value === "fee" || value === "nonce";

/**
 * What the chain said about a stale version's exact signed hash (mc-wallet
 * 673). Recorded locally only, like the reason:
 * - `rejected`: the sequencer refused that hash, so this version was never
 *   included and cannot land, but the nonce moved or could not be read, so a
 *   co-signer may have sent a different version of the same calls;
 * - `rejected-nonce-unused`: the same, while the multisig's nonce was still the
 *   one this version was signed for, so nothing else was sent at it;
 * - `reverted`: included and failed on chain. It used its nonce and paid its
 *   fee, and transferred nothing. Settled: it is never looked up or retried.
 */
export type ArgentMultisigStaleOutcome = "rejected" | "rejected-nonce-unused" | "reverted";

/** True for a known stale outcome. */
export const isArgentMultisigStaleOutcome = (value: unknown): value is ArgentMultisigStaleOutcome =>
  value === "rejected" || value === "rejected-nonce-unused" || value === "reverted";
