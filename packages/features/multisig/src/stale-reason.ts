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
