/**
 * Which of the wallet's own error messages are plumbing a reader must not see
 * as written (mc-wallet issue 652).
 *
 * The default is to show a message as written. A message is replaced with the
 * caller's context sentence or the generic fallback ONLY when it is listed in
 * `REVIEWED_PLUMBING` — reviewed one by one, matched exactly, and justified as
 * stating no fact a reader needs: an input guard on a value our own code
 * derived, an adapter's output or storage plumbing, or a guard no reader action
 * reaches. When in doubt a message stays visible. There are no prefix families:
 * an "Invalid …" a reviewer has not listed is shown, because a family rule hid
 * security and funds facts it was never meant to cover.
 *
 * Security, cryptographic, privacy, and funds messages — a failed signature,
 * key, hash, proof, chain id, origin, approval, or a private-balance refusal —
 * are never listed. They are shown as written, or mapped to a reviewed
 * sentence that keeps the fact.
 *
 * Ledger device rejections are not here: they arrive as catalog codes and are
 * shown with the catalog's own sentence (see ./friendly-error).
 *
 * Pure data and predicates; no DOM, clock, or network access.
 */

import { ledgerMessage } from "@bramble/ledger-protocol/errors";
import { RPC_REFUSED_MESSAGE } from "@bramble/starknet/rpc-transport";
import {
  BACKUP_UNREADABLE,
  KEY_IMPORT_FAILED,
  PREPARATION_MISMATCH,
  REVIEW_MOVED,
  SEED_IMPORT_FAILED,
  UNRECOGNIZED_RELEASE,
  VAULT_UNVERIFIED,
  WRONG_CHAIN_ENDPOINT,
} from "./friendly-error-shared";

// A failed key, signature, hash, chain, class, or storage-integrity check
// (issue 652 copy review). Each sentence keeps the check that failed and says
// what did not happen; the raw diagnostic stays behind the toast's copy control.
const SIGNATURE_KEY_MISMATCH =
  "The signature doesn't match this account's key, so nothing was submitted.";
const HASH_FAILED = "Couldn't compute this request's hash, so nothing was signed.";
const CLASS_UNEXPECTED =
  "This contract doesn't match the version Bramble expects, so nothing was submitted.";
const SECURITY_CHECK_COPY: readonly (readonly [string, string])[] = [
  [
    "invalid ledger public key",
    "Your Ledger returned a public key Bramble can't use. Nothing was added.",
  ],
  ["invalid account public key", "That public key isn't valid, so the account wasn't added."],
  ["krusty kms signature key mismatch", SIGNATURE_KEY_MISMATCH],
  [
    "krusty kms public-key probe did not verify",
    "Bramble couldn't verify its signing key. Nothing was signed.",
  ],
  ["ledger signature verification failed", ledgerMessage("signature-verify-failed")],
  ["signature public key does not match the account", SIGNATURE_KEY_MISMATCH],
  [
    "typed data chain does not match the active network",
    "This message is for a different network than the one you're on. Nothing was signed.",
  ],
  ["rpc endpoint chain id does not match the account network", WRONG_CHAIN_ENDPOINT],
  ["invalid message hash", HASH_FAILED],
  ["invalid transaction hash", HASH_FAILED],
  ["typed data produced an invalid hash", HASH_FAILED],
  ["typed data cannot be hashed", HASH_FAILED],
  ["invalid swap preparation commitment", PREPARATION_MISMATCH],
  ["invalid privacy preparation commitment", PREPARATION_MISMATCH],
  ["argent account class hash does not match the pinned release", CLASS_UNEXPECTED],
  ["argent multisig class hash does not match the pinned release", CLASS_UNEXPECTED],
  ["deployed argent multisig class does not match the pinned release", CLASS_UNEXPECTED],
  ["declared argent multisig class does not match the stable pin", CLASS_UNEXPECTED],
  ["supplied class hash does not match the starknet contract class", CLASS_UNEXPECTED],
  [
    "account deployment parameters do not match the stored address",
    "These deployment details don't match this account's address. Nothing was submitted.",
  ],
  ["vault migration verification failed", VAULT_UNVERIFIED],
];

// Developer wording with no fact at stake (issue 652 copy review).
const PREPARE_FAILED = "Couldn't prepare this transaction. Try again.";
const PLUMBING_COPY: readonly (readonly [string, string])[] = [
  [
    "ledger strk20 viewing key unavailable",
    "Couldn't read the private-balance key from your Ledger. Try again.",
  ],
  [
    "ledger strk20 viewing-key limit reached",
    "This Ledger has reached the number of private accounts Bramble can keep.",
  ],
  ["ledger account index out of range", "That Ledger account number isn't supported."],
  ["local funding is unavailable", PREPARE_FAILED],
  ["transfer calldata is unavailable", PREPARE_FAILED],
  ["signing key unavailable", PREPARE_FAILED],
  ["no account selected", "Select an account first."],
  ["clipboard unavailable", "Couldn't copy. Copy it manually."],
  ["qr payload too long", "That's too long for a QR code."],
  // Persistent: corrupt settings storage, or a downgrade past a renamed key.
  // "Try again" cannot fix it, so the sentence points at the backup.
  ["invalid stored preferences", "Couldn't read your saved settings. Restore them from a backup."],
  // The endpoint refused before anything was submitted; the sentence keeps that
  // fact, which the generic rate-limit line dropped.
  [
    RPC_REFUSED_MESSAGE.toLowerCase(),
    "The RPC endpoint refused this request (rate limit or gateway). Nothing was submitted. Wait a moment and try again.",
  ],
];

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
  // The recovery-phrase toast and the backup restore: the reader's own input.
  ["invalid recovery phrase", SEED_IMPORT_FAILED],
  ["invalid preferences backup", BACKUP_UNREADABLE],
  // A request the reader was reviewing changed underneath it.
  ["the account changed since this request was reviewed", REVIEW_MOVED],
  // A private-balance refusal, in the words the wallet already gives sites.
  ["insufficient private balance", "Insufficient private balance"],
  // An earlier STRK20 write may still land, so this one was refused before it
  // was sent (mc-wallet issue 661). Activity shows the earlier one; checking
  // again re-runs the background's resolution of it.
  [
    "strk20 services unavailable: an earlier private transaction from this account may still be in progress",
    "An earlier private transaction from this account may still be in progress. Check Activity, then check again.",
  ],
  // The same, for an earlier write no check can resolve. Its marker now
  // survives a browser restart (mc-wallet 668), so the sentence names the one way on,
  // which the screen it points to spells out the risk of.
  [
    "strk20 services unavailable: an earlier private transaction from this account may still be in progress, and no check can confirm it",
    "An earlier private transaction from this account may still be in progress, and no check can confirm it. To continue anyway, open Settings → Unlock private transactions.",
  ],
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
  // be confirmed as a token.
  [
    "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an nft instead; revoke it from the dapp",
    "Couldn't confirm that contract is a token, so the revoke wasn't sent. Revoke it from the site that asked.",
  ],
  ...SECURITY_CHECK_COPY,
  ...PLUMBING_COPY,
];

/**
 * Words that mark a security, cryptographic, privacy, or funds fact. The
 * lowercase backstop in ./friendly-error never collapses a message containing
 * one, and no `REVIEWED_PLUMBING` entry may contain one unless it is listed in
 * `PLUMBING_DESPITE_FACT_WORD` with its reason (checked by the tests).
 */
export const FACT_TERMS =
  /\b(?:signatures?|signed|signing|public[- ]?keys?|private keys?|key material|viewing[- ]keys?|hash(?:es|ed)?|proofs?|chain(?: ?id)?|chainid|verif\w*|mismatch|does not match|do not match|not from|pinned|commitment|origins?|phishing|spoof\w*|scam|poison\w*|mimic\w*|leak\w*|linkage|anonymi[sz]er|executor|nonce|replay\w*|expired|tamper\w*|forged|allowances?|approv\w*|fee cap|ceiling|unknown contract|sanction\w*|screen\w*|blocked|integrity|schema|strk20|shadow (?:account|sweep)s?|sweep\w*|private|privacy|notes?|shield\w*|recovered vault|imported-seed vault|prepared|envelope|commit state|swap build|proceeds|minimum|beneficiary|lookalike|router|entrypoint|spender)\b/i;

/**
 * Plumbing messages, lowercased, each with the reason it states nothing a
 * reader needs. Exact match only. Adding a line here hides a message: it needs
 * the same review the list had.
 */
export const REVIEWED_PLUMBING: ReadonlyMap<string, string> = new Map([
  // --- Input guards on values our own code derived or the UI pre-validated ---
  ["invalid ledger account index", "picker supplies a range-checked index"],
  ["invalid ledger path application", "picker supplies a known application"],
  ["invalid starknet network", "network id comes from the wallet's own list"],
  ["invalid account deployment salt", "salt is derived, not entered"],
  ["invalid account contract type", "contract type comes from a fixed choice"],
  ["invalid account id", "id is the wallet's own"],
  ["invalid account address", "address is derived or pre-validated"],
  ["invalid account", "account record built by the wallet"],
  ["invalid account label", "label is pre-validated in the UI"],
  ["invalid address book entry", "entry is pre-validated in the UI"],
  ["invalid custom network", "network form is pre-validated in the UI"],
  ["invalid derivation index", "index is derived"],
  ["invalid display preference", "choice comes from a fixed control"],
  ["invalid explorer api endpoint", "endpoint is pre-validated in the UI"],
  ["invalid group icon", "icon comes from a fixed choice"],
  ["invalid group name", "name is pre-validated in the UI"],
  ["invalid indexer endpoint", "endpoint is pre-validated in the UI"],
  ["invalid rpc endpoint", "endpoint is pre-validated in the UI"],
  ["invalid nostr relay endpoint", "endpoint is pre-validated in the UI"],
  ["invalid nostr relay configuration", "configuration built by the wallet"],
  ["invalid nostr relay idle timeout", "timeout is a constant"],
  ["invalid preferences", "preferences record built by the wallet"],
  ["invalid wallet contact card", "card built by the wallet"],
  ["invalid token", "token record built by the wallet"],
  ["invalid token address", "address is pre-validated in the UI"],
  ["invalid token decimals", "decimals come from a contract read"],
  ["invalid nft", "record built by the wallet"],
  ["invalid nft contract address", "address is pre-validated in the UI"],
  ["invalid nft ownership address", "address is the wallet's own account"],
  ["invalid nft transfer address", "recipient is pre-validated in the UI"],
  ["invalid transfer address", "recipient is pre-validated in the UI"],
  ["invalid transfer amount", "amount is pre-validated in the UI"],
  ["invalid starknet name", "name is pre-validated in the UI"],
  ["invalid mnemonic derivation input", "derivation input built by the wallet"],
  ["invalid stark derivation input", "derivation input built by the wallet"],
  ["invalid stark address derivation input", "derivation input built by the wallet"],
  ["invalid nostr derivation input", "derivation input built by the wallet"],
  ["invalid nostr application-data input", "input built by the wallet"],
  ["invalid nostr application-data batch", "batch built by the wallet"],
  ["invalid recovery account selection", "selection comes from the scan's own list"],
  ["invalid unlock session passphrase", "session guard after the vault decrypted"],
  ["invalid unlock session ttl", "ttl is a constant"],
  ["invalid vault", "vault built by the wallet before writing it"],
  ["invalid json value", "storage serialisation guard"],
  ["a braavos account must name the class it was deployed with", "panel passes the class"],
  ["account creation uses this wallet's own derivation only", "layer guard"],
  ["account is not a ledger account", "layer guard"],
  ["openzeppelin accounts do not accept a deployment salt", "layer guard"],
  ["ready derivation does not take a passphrase", "layer guard"],
  ["ready derivation is only valid for argent accounts", "layer guard"],
  ["query signer is only available for argent accounts", "layer guard"],
  ["duplicate recovery account selection", "layer guard"],
  ["recovery accounts resolve to a duplicate address", "layer guard"],
  ["history account id does not belong to the network", "layer guard"],
  ["no calls to estimate", "layer guard"],
  ["no calls to submit", "layer guard"],
  ["unsupported signer-management action", "action comes from a fixed control"],
  // --- Krusty KMS adapter output and module checks ---------------------------
  ["krusty kms module did not load as an object", "module load"],
  ["krusty kms returned an invalid account address", "adapter output shape"],
  ["krusty kms returned invalid account address", "adapter output shape"],
  ["krusty kms returned an invalid mnemonic", "adapter output shape"],
  ["krusty kms returned an invalid mnemonic validation result", "adapter output shape"],
  ["krusty kms returned an invalid nostr gift wrap", "adapter output shape"],
  ["krusty kms returned invalid nostr application data", "adapter output shape"],
  // --- Session and storage plumbing -----------------------------------------
  ["unlock session changed during vault creation", "concurrency guard; nothing was written"],
  ["unlock session changed during network switch", "concurrency guard"],
  ["unlock session changed during account selection", "concurrency guard"],
  ["unlock session changed during account reconciliation", "concurrency guard"],
  ["unlock session changed during account mutation", "concurrency guard"],
  ["unlock session mirror not cleared", "session storage cleanup"],
  ["unlock session mirror not revoked", "session storage cleanup"],
  ["storage key must be namespaced", "storage guard"],
  ["imported seed unavailable", "storage read guard"],
  ["vault migration cleanup failed", "cleanup after a verified migration"],
  ["browser storage.local is unavailable", "browser API missing"],
  ["browser storage.session is unavailable", "browser API missing"],
  ["browser storage.sync is unavailable", "browser API missing"],
  ["trusted browser storage access is unavailable", "browser API missing"],
  // --- Transport and response parsing --------------------------------------
  ["request failed", "HTTP helper; status is behind the copy control"],
  ["response was not json", "HTTP helper"],
  ["starkscan request failed", "indexer transport"],
  ["invalid starkscan response", "indexer parse"],
  ["invalid starkscan address", "indexer request guard"],
  ["invalid starkscan block tag", "indexer request guard"],
  ["invalid starkscan cursor", "indexer request guard"],
  ["invalid starkscan page limit", "indexer request guard"],
  ["starkscan balance input must contain one indexed network", "indexer request guard"],
  ["invalid token balance response", "balance read parse"],
  ["invalid nostr gift wrap", "relay event parse"],
  ["invalid nostr gift wrap batch", "relay event parse"],
  ["invalid argent multisig address", "response parse"],
  ["invalid argent multisig class response", "response parse"],
  ["invalid argent multisig configuration", "configuration parse"],
  ["invalid argent multisig signer event", "event parse"],
  ["invalid argent multisig signer membership response", "response parse"],
  ["invalid argent multisig signers response", "response parse"],
  ["invalid argent multisig threshold or signer count", "configuration parse"],
  ["invalid argent multisig threshold response", "response parse"],
  ["invalid argent signer guid", "response parse"],
  ["invalid argent signer guids", "response parse"],
  ["invalid signer guid", "response parse"],
  ["invalid signer account class response", "response parse"],
  ["argent multisig operations unavailable", "collaborator not wired"],
  // avnu answers that fail to parse; the swap screen's own route sentence covers them.
  ["invalid slippage", "slippage comes from a fixed control"],
  ["invalid swap quote", "avnu response parse"],
  ["invalid swap call", "avnu response parse"],
  ["invalid swap build response", "avnu response parse (a refusal names its check)"],
  ["invalid token list response", "avnu response parse"],
  ["token list failed", "avnu transport"],
  ["swap service unavailable", "avnu transport"],
  ["invalid provider response", "page bridge parse"],
  ["invalid response", "relay JSON-RPC envelope parse"],
  ["deployment fee estimation unavailable", "fee lane not wired"],
  // --- Unreachable ------------------------------------------------------------
  ["strk20 signer does not sign messages", "unreachable: the call-set signer is never asked"],
  ["strk20 signer does not expose public keys", "unreachable: as above"],
  ["strk20 signer does not declare classes", "unreachable: as above"],
  ["strk20 signer does not deploy accounts", "unreachable: as above"],
  ["unreachable strk20 retry state", "unreachable: the retry loop's exhaustive guard"],
  // --- Fallback codes and UI wiring -----------------------------------------
  ["shadow accounts screen is not bound", "UI wiring guard: no document to render into"],
  // The cache write is best effort: the fetched list stays live and the
  // failure is caught where it is raised (phishing-feed.ts).
  ["phishing feed cache exceeds the chunk budget", "cache storage budget"],
  // --- Plumbing that names a fact word (see PLUMBING_DESPITE_FACT_WORD) --------
  // (also "invalid swap build response" above: avnu's JSON did not parse; every
  // safety refusal of a parsed build is its own "swap build …" message)
  ["krusty kms returned invalid class hash json", "KMS's static class table parse"],
  ["krusty kms returned an invalid class hash", "KMS's static class table parse"],
  ["krusty kms returned invalid class hashes", "KMS's static class table parse"],
  ["krusty kms class hashes are missing oz accounts", "KMS's static class table parse"],
  ["devnet account class hash is invalid", "constant class table parse"],
  ["invalid account class hash", "class resolved from the wallet's own table"],
  ["account class hash does not belong to its account family", "our two inputs disagreed"],
]);

/**
 * `REVIEWED_PLUMBING` entries that contain a `FACT_TERMS` or other sensitive
 * word ("signer"), and why each is still plumbing: the KMS's or wallet's own
 * static class table, an avnu JSON parse, unreachable call-set signer guards,
 * or a signer-list response parse. None reports a check on chain data, a key,
 * or a signature. The tests pin this set and fail on any other sensitive entry.
 */
export const PLUMBING_DESPITE_FACT_WORD: ReadonlySet<string> = new Set([
  "krusty kms returned invalid class hash json",
  "krusty kms returned an invalid class hash",
  "krusty kms returned invalid class hashes",
  "krusty kms class hashes are missing oz accounts",
  "devnet account class hash is invalid",
  "invalid account class hash",
  "account class hash does not belong to its account family",
  "strk20 signer does not sign messages",
  "strk20 signer does not expose public keys",
  "strk20 signer does not declare classes",
  "strk20 signer does not deploy accounts",
  "unreachable strk20 retry state",
  // A screen-wiring guard and a cache budget; neither is a check on an
  // account, a key, or the phishing list itself.
  "shadow accounts screen is not bound",
  "phishing feed cache exceeds the chunk budget",
  "invalid swap build response",
  // Signer-list and signer-event response parses: "signer" names whose data
  // failed to parse, not a check on a key or a signature.
  "query signer is only available for argent accounts",
  "unsupported signer-management action",
  "invalid argent multisig signer event",
  "invalid argent multisig signer membership response",
  "invalid argent multisig signers response",
  "invalid argent multisig threshold or signer count",
  "invalid argent signer guid",
  "invalid argent signer guids",
  "invalid signer guid",
  "invalid signer account class response",
]);

// Templated plumbing: a missing KMS module export, the KMS's static class
// table, the account-family exhaustiveness guard, which no input reaches, and
// the QR encoder's self-check on its own layout (its "mismatch" is between two
// numbers the encoder computed, not a check on an address).
// The KMS result-field checks are not here: their field can be a public key or
// a signature, so they stay visible. The anchored grammar admits nothing else.
const KMS_TEMPLATE_PLUMBING =
  /^krusty kms export missing: [a-z0-9_]+$|^krusty kms class hashes are missing sn_(?:main|sepolia|devnet)$|^unknown account constructor shape: [^\s]+$|^qr layout mismatch: [^\s]+ cells for [^\s]+ bits$/;

/**
 * Whether a raw string is reviewed plumbing that must not be shown as written.
 * Exact match against `REVIEWED_PLUMBING`, or the KMS adapter's anchored
 * template shapes. Everything else is shown.
 */
export const isReviewedPlumbing = (trimmed: string): boolean => {
  const normalized = trimmed.toLowerCase();
  return REVIEWED_PLUMBING.has(normalized) || KMS_TEMPLATE_PLUMBING.test(normalized);
};
