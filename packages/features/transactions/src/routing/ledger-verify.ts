/**
 * Host-side verification of a Ledger-produced Stark signature against the stored
 * account public key. This is the fail-closed gate the signing seam runs before
 * any transaction is broadcast: the device blind-signs a hash and returns
 * `(r, s)`, and this recomputes nothing but checks that `(r, s)` is a valid
 * signature of that exact hash under the account's `publicKeyX`. A mismatch means
 * the wrong device, a corrupted exchange, or a substituted hash, and the caller
 * must abort with nothing submitted.
 *
 * This is a pure public-key operation via starknet.js's Stark curve — it does
 * NOT sign, derive a key, or validate a mnemonic, so it does not weaken the
 * "Krusty owns wallet crypto / fail closed" rule (which governs signing and key
 * derivation). The account stores only the x-coordinate, so the full curve point
 * is reconstructed at both possible y-parities and the signature is accepted if
 * it verifies under either — the same x-only check Starknet accounts use
 * on-chain. Deterministic; no clock, randomness, or device I/O.
 */

/**
 * Re-exports the shared Starknet platform verifier for transaction callers.
 * It fails closed on malformed values and performs no signing or derivation.
 */
export { verifyStarkSignature } from "@bramble/starknet/signature-verify";
