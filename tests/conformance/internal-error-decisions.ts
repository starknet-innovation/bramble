/**
 * Shown-as-written decisions recorded for errors audit F6, split from
 * ./internal-error-copy.test by the size budget. Each set names messages a
 * reviewer decided keep their words; adding one is a decision, not a fix.
 */

// Security, signing, key, chain, and storage-integrity checks (errors audit
// F6). Each reports a check on keys, signatures, hashes, chain data, pinned
// classes, or the encrypted store that failed or could not run: a fact the
// reader keeps, never collapsed. Reviewed copy may reword, not hide.
export const SECURITY_FACTS: ReadonlySet<string> = new Set([
  "Account is not the pinned Argent Multisig 0.2 class",
  "Account is not the pinned Argent multisig class",
  "Argent multisig requires exactly x signature(s)",
  "Argent multisig signature is not from a configured signer",
  "Argent multisig signatures must use distinct signers",
  "Braavos deployment chain id unavailable",
  "Committed encrypted envelope required",
  "Invalid Argent multisig management signer array",
  "Invalid Argent multisig nonce response",
  "Invalid Argent multisig signer public key",
  "Invalid Argent multisig transaction hash",
  "Invalid Ledger STRK20 viewing key",
  "Invalid multisig STRK20 key",
  "Multisig STRK20 key limit reached",
  "Invalid Ledger STRK20 viewing-key scope",
  "Invalid STRK20 approval",
  "Invalid STRK20 network configuration",
  "Invalid STRK20 viewing-key input",
  "Invalid Stark signing input",
  "Invalid Starknet contract class hash",
  "Invalid approval address",
  "Invalid approval payload",
  "Invalid encrypted store commit state",
  "Invalid encrypted store envelope",
  "Invalid imported-seed vault",
  "Invalid origin",
  "Invalid prepared Argent multisig resource bounds",
  "Invalid prepared Argent multisig transaction",
  "Invalid recovered vault",
  "Invalid x account class hash",
  "Krusty KMS class hashes are missing x",
  "Krusty KMS result missing non-zero private key: x",
  "Krusty KMS returned an invalid Nostr public key",
  "Krusty KMS returned an invalid STRK20 viewing key",
  "Krusty KMS returned invalid account key material",
  "Krusty KMS returned invalid public key",
  "RPC reported another chain for a Starknet name lookup",
  "RPC returned a non-felt class hash",
  "RPC returned an invalid accepted Starknet block hash",
  "Unsupported vault schema",
]);

// Private-balance, fee-ceiling, relay, and site-request facts in developer
// voice (errors audit F6). Each names a limit the reader hit, a fee check, a
// relay refusal, or a request the wallet could not review; shown as written
// until reviewed copy keeps the fact.
export const PRIVATE_FACTS: ReadonlySet<string> = new Set([
  "approval summary too long to review",
  "invalid note amount",
  "invalid strk20 action batch",
  "invalid token note set",
  "private balance overflow",
  "too many notes",
  "strk20 converted fee could not be verified independently",
  "strk20 relay fee exceeds the reviewed ceiling",
  "strk20 private submission unavailable",
  "strk20 private submission unavailable: no private relay is configured for this network",
  "strk20 private submission unavailable: x",
  "Argent multisig private proof does not match the signed transaction",
  "Argent multisig private proof is missing",
  "Invalid Argent multisig private proof",
  "This authorization is too large to share.",
  "This private transaction expired. Refresh it.",
  "Waiting for co-owners to authorize this private action.",
  "Amount exceeds this multisig's balance.",
  "Amount exceeds this multisig's private balance.",
  "invalid multisig private action",
  "That token isn't tracked on this network.",
]);

// Shadow-account facts (issue 443), pending reviewed copy that keeps each one.
// Owned with the shadow-account screens; none is plumbing. (The record and
// sweep refusals have reviewed copy in the privacy table.)
export const SHADOW_PENDING_COPY: ReadonlySet<string> = new Set([
  "strk20 services unavailable: could not list shadow accounts (x)",
]);

// The panel's own fallbacks, shown only when a rejection carries no message of
// its own; each names the action that did not complete (errors audit F6).
export const UI_FALLBACKS: ReadonlySet<string> = new Set([
  "Account recovery failed",
  "Account search is unavailable",
  "Account update failed",
  "Allowance refresh failed",
  "Analytics preference failed",
  "Backup export failed",
  "Backup restore failed",
  "NFT preference failed",
  "Complete signer setup failed",
  "Contact removal failed",
  "Contact save failed",
  "Copy failed",
  "Could not add that folder",
  "Could not add that token",
  "Could not check this recovery phrase",
  "Could not derive this account",
  "Could not move that account",
  "Could not switch surface",
  "Couldn't add that collectible",
  "Couldn't create that folder",
  "Couldn't delete that folder",
  "Couldn't finish signer setup",
  "Couldn't look up that signer",
  "Couldn't prepare that signer change",
  "Couldn't remove that collectible",
  "Couldn't remove that token",
  "Couldn't update that collectible",
  "Couldn't update that folder",
  "Couldn't prepare this private action.",
  "Couldn't update this multisig's key.",
  "Currency update failed",
  "Deployment review failed",
  "Diagnostic preference failed",
  "Export failed",
  "Import failed",
  "Invalid deployment fields",
  "Lock failed",
  "Name update failed",
  "Open funding transfer failed",
  "Phrase validation is unavailable",
  "Prepare Ready multisig transaction failed",
  "Prepare signer change failed",
  "Privacy registration preparation failed",
  "Ready multisig request failed",
  "Recovery phrase failed",
  "Signer key lookup failed",
  "Sync Ready multisig failed",
  "That request didn't go through",
  "The transfer didn't go through",
  "Theme update failed",
  "Token update failed",
  "Unlock failed",
  "VIP preference failed",
  "Wallet request preference failed",
]);
