/**
 * Which raw errors are the wallet's own plumbing, and which carry a fact the
 * reader must still be told (mc-wallet issue 652).
 *
 * `friendlyError` shows an unmapped capitalised string as written, because
 * curated copy starts with a capital. The background's own diagnostics often
 * do too ("Invalid Ledger account index", "Krusty KMS returned invalid class
 * hash JSON", "Unlock session changed during vault creation"), and those were
 * reaching readers verbatim. This module draws the line in three parts:
 *
 * 1. `FACT_KEPT` — diagnostics reviewed as security or cryptographic facts (a
 *    key, signature, hash, proof, chain id, or check that failed). They are
 *    never collapsed: the reader is told what failed, in these words until a
 *    reviewed sentence replaces them in the copy table.
 * 2. `INTERNAL_DIAGNOSTICS` — diagnostics reviewed as plumbing even though they
 *    mention a fact word ("class hash JSON" is a parse failure, not a failed
 *    check). They take the caller's context sentence or the generic fallback.
 * 3. `INTERNAL_FAMILIES` — the shapes our plumbing errors take, for strings not
 *    reviewed one by one (templates, new throws). A match is collapsed ONLY when
 *    `FACT_TERMS` finds no fact in it, so an unreviewed failed check still
 *    reaches the reader as written rather than as "Something went wrong".
 *
 * Ledger device rejections are not here: they arrive as catalog codes and are
 * shown with the catalog's own sentence (see ./friendly-error).
 *
 * Pure data and predicates; no DOM, clock, or network access.
 */

import {
  KEY_IMPORT_FAILED,
  SEED_IMPORT_FAILED,
  SWAP_ROUTE_UNSAFE,
  UNRECOGNIZED_RELEASE,
} from "./friendly-error-shared";

/**
 * Background diagnostics a reader can act on, mapped to sentences the wallet
 * already uses for the same situation. Merged into ERROR_COPY. Lowercased raw
 * diagnostic to sentence; one line each, so a reviewed replacement is a
 * one-line change.
 */
export const INTERNAL_ERROR_COPY: readonly (readonly [string, string])[] = [
  // The pasted phrase or key is the reader's to fix.
  ["invalid mnemonic", SEED_IMPORT_FAILED],
  ["invalid mnemonic word count", SEED_IMPORT_FAILED],
  ["invalid private key", KEY_IMPORT_FAILED],
  // avnu's quote answered a different pair: the swap was refused for safety.
  ["swap quote does not match the requested pair", SWAP_ROUTE_UNSAFE],
  // The account's deploy class is not one this wallet derives: the same fact
  // the deployed-account checks already tell the reader.
  ["invalid argent account class hash", UNRECOGNIZED_RELEASE.ready],
  ["invalid braavos account class hash", UNRECOGNIZED_RELEASE.braavos],
  // Already the sentence a reader needs; listed so the coverage check can tell
  // "reviewed and kept" from "never looked at" (it was past the scan's old
  // length limit).
  [
    "couldn't estimate the network fee for this swap, so nothing was prepared. the quote may have moved, or the account may not hold enough to cover the swap and its fee. try again, or reduce the amount.",
    "Couldn't estimate the network fee for this swap, so nothing was prepared. The quote may have moved, or the account may not hold enough to cover the swap and its fee. Try again, or reduce the amount.",
  ],
  // A security refusal: the revoke was not sent because the contract could not
  // be confirmed as a token. Shown as written until reviewed copy replaces it
  // (proposal: "Couldn't confirm that contract is a token, so the revoke wasn't
  // sent. Revoke it from the site that asked.").
  [
    "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an nft instead; revoke it from the dapp",
    "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an NFT instead; revoke it from the dapp",
  ],
];

/**
 * Words that mark a security or cryptographic fact. A family match containing
 * one is never collapsed, because hiding a failed signature, key, hash, proof,
 * chain-id, or verification check is worse than showing a developer's words.
 */
export const FACT_TERMS =
  /\b(?:signatures?|signing key|public[- ]?keys?|private keys?|viewing[- ]keys?|hash(?:es|ed)?|proofs?|chain(?: id)?|verif(?:y|ied|ication)|mismatch|does not match|do not match|not from|pinned|commitment)\b/i;

/**
 * The shapes the wallet's own plumbing errors take. Matched on the trimmed raw
 * string. Each is a prefix the background or a platform adapter uses for input
 * validation, adapter output checks, session guards, or storage state — never a
 * sentence written for a reader.
 */
const INTERNAL_FAMILIES: readonly (readonly [family: string, pattern: RegExp])[] = [
  ["kms", /^Krusty KMS\b/],
  ["validation", /^Invalid\b/],
  ["session-guard", /^Unlock session\b/],
  ["unsupported", /^Unsupported\b/],
  [
    "vault-store",
    /^(?:Vault migration|Committed encrypted envelope|Storage (?:key|access)|Imported seed unavailable)/,
  ],
  ["indexer", /^Starkscan\b/],
  ["nostr", /^Nostr relays?\b/],
  ["phishing-feed", /^Phishing feed\b/],
  ["rpc-plumbing", /^(?:RPC returned\b|No RPC endpoints? |RPC endpoints are\b)/],
  ["http", /^(?:Response was not JSON|Request failed)$/],
  ["strk20-signer", /^STRK20 signer\b/],
  ["argent-plumbing", /^Argent multisig (?:operations|public signer configuration) unavailable/],
];

/**
 * Plumbing diagnostics that mention a fact word but report no failed check:
 * an adapter returned malformed output, or our own inputs disagreed. Lowercased.
 * They take the context sentence, never their own words.
 */
export const INTERNAL_DIAGNOSTICS: ReadonlySet<string> = new Set([
  // Krusty KMS output and module checks (issue 652, item 2).
  "krusty kms returned invalid class hash json",
  "krusty kms returned an invalid class hash",
  "krusty kms returned invalid class hashes",
  "krusty kms class hashes are missing oz accounts",
  "krusty kms class hashes are missing sn_main",
  "krusty kms class hashes are missing sn_sepolia",
  "krusty kms class hashes are missing sn_devnet",
  "krusty kms returned invalid public key",
  "krusty kms returned an invalid nostr public key",
  "krusty kms returned an invalid strk20 viewing key",
  "devnet account class hash is invalid",
  // Vault input checks on values our own code derived (issue 652, item 1).
  "invalid account class hash",
  "account class hash does not belong to its account family",
  "invalid stark signing input",
  "invalid strk20 viewing-key input",
  "invalid ledger strk20 viewing-key scope",
  "invalid starknet contract class hash",
  "braavos deployment chain id unavailable",
  // Guards between our own layers; no reader action reaches them.
  "a braavos account must name the class it was deployed with",
  "account creation uses this wallet's own derivation only",
  "account is not a ledger account",
  "openzeppelin accounts do not accept a deployment salt",
  "ready derivation does not take a passphrase",
  "ready derivation is only valid for argent accounts",
  "query signer is only available for argent accounts",
  "duplicate recovery account selection",
  "recovery accounts resolve to a duplicate address",
  "history account id does not belong to the network",
  "no calls to estimate",
  "no calls to submit",
  "strk20 signer does not sign messages",
  "strk20 signer does not expose public keys",
  "strk20 signer does not declare classes",
  "strk20 signer does not deploy accounts",
]);

/**
 * Diagnostics reviewed as facts the reader must be told. Shown as written until
 * a reviewed sentence lands in the copy table; the conformance test asserts each
 * still names what failed. Lowercased.
 */
export const FACT_KEPT: ReadonlySet<string> = new Set([
  // Keys and signatures.
  "invalid ledger public key",
  "invalid account public key",
  "invalid argent multisig signer public key",
  "invalid ledger strk20 viewing key",
  "krusty kms signature key mismatch",
  "krusty kms public-key probe did not verify",
  "signature public key does not match the account",
  "ledger signature verification failed",
  "argent multisig signature is not from a configured signer",
  "argent multisig signatures must use distinct signers",
  // Hashes and commitments.
  "invalid message hash",
  "invalid transaction hash",
  "invalid argent multisig transaction hash",
  "typed data produced an invalid hash",
  "typed data cannot be hashed",
  "supplied class hash does not match the starknet contract class",
  "invalid swap preparation commitment",
  "invalid privacy preparation commitment",
  // Chain identity.
  "typed data chain does not match the active network",
  "rpc endpoint chain id does not match the account network",
  "rpc reported another chain for a starknet name lookup",
  // Pinned contract classes.
  "argent account class hash does not match the pinned release",
  "argent multisig class hash does not match the pinned release",
  "deployed argent multisig class does not match the pinned release",
  "declared argent multisig class does not match the stable pin",
  "account is not the pinned argent multisig 0.2 class",
  "account is not the pinned argent multisig class",
  "account deployment parameters do not match the stored address",
  "declared argent multisig class is malformed",
  // Malformed chain data where a hash belongs: the reader is told the RPC
  // answered wrongly rather than that something vague went wrong.
  "rpc returned a non-felt class hash",
  "rpc returned an invalid accepted starknet block hash",
  // Integrity of the stored wallet.
  "vault migration verification failed",
]);

/** Which family, if any, an unreviewed raw string belongs to. */
const internalFamily = (trimmed: string): string | null => {
  for (const [family, pattern] of INTERNAL_FAMILIES) {
    if (pattern.test(trimmed)) return family;
  }
  return null;
};

/**
 * Whether a raw string is the wallet's own plumbing and must not be shown as
 * written. Fails toward showing: a reviewed fact, or an unreviewed family match
 * that names a fact, is never treated as plumbing.
 */
export const isInternalDiagnostic = (trimmed: string): boolean => {
  const normalized = trimmed.toLowerCase();
  if (FACT_KEPT.has(normalized)) return false;
  if (INTERNAL_DIAGNOSTICS.has(normalized)) return true;
  return internalFamily(trimmed) !== null && !FACT_TERMS.test(trimmed);
};
