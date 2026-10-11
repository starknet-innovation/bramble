/**
 * Reader-facing sentences for multisig and co-signer coordination diagnostics,
 * consumed by the main table in ./friendly-error-copy. Split from it by the
 * size budget; same contract — exact lowercase diagnostic to sentence.
 */
import { OUTCOME_UNKNOWN, SAVE_FAILED, SUBMISSION_UNKNOWN } from "./friendly-error-shared";

const MULTISIG_DEPLOY_PREPARE = "Couldn't prepare the deployment. Try again.";
const MULTISIG_BALANCES = "Couldn't load multisig balances. Check your connection and try again.";

/**
 * The second-press prompt before removing an undeployed multisig, whose setup
 * this wallet alone holds (Sherlock 214).
 */
export const UNDEPLOYED_REMOVAL_PROMPT =
  "This multisig isn't deployed. Removing it deletes the setup needed to deploy it. Press again to remove it.";

/** Multisig and co-signer entries merged into ERROR_COPY. */
export const MULTISIG_ERROR_COPY: readonly (readonly [string, string])[] = [
  // --- Multisig ------------------------------------------------------------
  // The screens say multisig, not the vendor's name, and transaction rather
  // than intent. The raw diagnostics still say "Argent multisig intent"; these
  // are the words a signer reads.

  // A transaction that has been overtaken. The move is always the same: this
  // one cannot be used, make a current one.
  [
    "argent multisig intent is stale after a configuration change",
    "The signers changed since this transaction was created. Create a new one.",
  ],
  [
    "argent multisig intent nonce is no longer current",
    "This transaction is out of date. Create a new one.",
  ],
  ["argent multisig intent not found", "That transaction is no longer saved."],
  ["conflicting argent multisig intent id", "That transaction id is already in use."],
  [
    "argent multisig intent already has its threshold signatures",
    "This transaction already has every signature it needs.",
  ],
  ["this argent multisig signer already signed the intent", "This signer has already signed."],
  [
    "signature is not valid for this exact argent multisig intent",
    "That signature doesn't match this transaction.",
  ],
  ["argent multisig threshold is not satisfied", "Not enough signatures yet."],

  // Signer set and authority.
  [
    "a supplied public key is not a current stark signer for this multisig",
    "That public key isn't a current signer on this multisig.",
  ],
  [
    "selected account is not a current argent multisig signer",
    "That account isn't a signer on this multisig.",
  ],
  [
    "selected signer account is unavailable on this network",
    "That signer account isn't available on this network.",
  ],
  [
    "selected signer is not a member of the reviewed constructor",
    "That signer isn't in the reviewed signer set.",
  ],
  [
    "signer public keys are invalid or duplicated",
    "Check the signer keys: one is invalid or repeated.",
  ],
  [
    "signer keys cannot be verified until the multisig is deployed",
    "Signer keys can't be checked until the multisig is deployed.",
  ],
  [
    "signer-management intents require the complete current public signer configuration",
    "Changing signers needs the current signer set. Refresh and try again.",
  ],
  ["signer account lookup unavailable", "Couldn't look up that signer. Try again."],
  ["resolve multisig signer account failed", "Couldn't resolve that signer account. Try again."],

  // Deployment.
  [
    "argent multisig deployment address needs strk before deployment",
    "Send STRK to the predicted address before deploying.",
  ],
  [
    "argent multisig deployment did not reach the network. try again.",
    "The deployment didn't reach the network. Try again.",
  ],
  [
    "argent multisig deployment must exactly match a fresh fee review",
    "The fee review is out of date. Check the fee again before deploying.",
  ],
  [
    "argent multisig deployment review address mismatch",
    "The reviewed address no longer matches. Check the fee and address again.",
  ],
  ["argent multisig deployment review unavailable", MULTISIG_DEPLOY_PREPARE],
  ["review ready multisig deployment failed", MULTISIG_DEPLOY_PREPARE],
  ["deploy ready multisig failed", SUBMISSION_UNKNOWN("The deployment")],
  [
    "signer set, threshold, and salt do not reproduce the watched multisig address",
    "These signers and threshold don't produce the watched address. Check them.",
  ],
  [
    "stable argent multisig 0.2 class is not declared on this network",
    "The pinned Ready Multisig 0.2 class isn't declared on this network.",
  ],

  // Submitted, outcome not yet known. Retrying blind is the one thing that
  // could double-spend a nonce, so both point at Activity first.
  ["argent multisig deployment outcome is unresolved", OUTCOME_UNKNOWN],
  ["argent multisig submission outcome is unresolved", OUTCOME_UNKNOWN],
  [
    "argent multisig has a pending or unresolved operation",
    "This multisig already has a transaction in flight. Wait for it to settle.",
  ],

  // A package or claim the wallet would not vouch for.
  [
    "invalid argent multisig intent package",
    "That package isn't a valid transaction. Ask for a fresh copy.",
  ],
  [
    "invalid argent multisig prepared transaction",
    "That prepared transaction isn't valid. Create it again.",
  ],
  [
    "invalid argent multisig signature import",
    "That isn't a valid signature. Ask for a fresh copy.",
  ],
  ["invalid argent multisig signing claim", "That signing request couldn't be verified."],
  ["invalid argent multisig submission claim", "That submission couldn't be verified."],
  ["invalid argent multisig deployment operation", "That deployment request couldn't be verified."],

  // Not here.
  ["argent multisig not found", "That multisig isn't saved in this wallet."],
  ["multisig not found on the active network", "That multisig isn't on this network."],
  ["switch to the multisig network first", "Switch to this multisig's network first."],
  ["multisig balances unavailable", MULTISIG_BALANCES],
  ["multisig balance snapshot unavailable", MULTISIG_BALANCES],
  ["multisig balances are loading.", "Multisig balances are loading."],
  ["add ready multisig failed", "Couldn't add that multisig. Try again."],
  ["remove ready multisig failed", "Couldn't remove that multisig. Try again."],
  ["remove ready multisig intent failed", "Couldn't delete that transaction. Try again."],
  [
    "confirm removal of terminal argent multisig history",
    "Press again to delete this multisig's history.",
  ],
  ["confirm removal of an undeployed argent multisig", UNDEPLOYED_REMOVAL_PROMPT],

  // Co-signer coordination over the relay. The fallback is always the same:
  // copy the package and send it yourself.
  ["co-signer sync failed", "Couldn't sync with your co-signers. Try again."],
  ["secure co-signer share failed", "Couldn't share that securely. Copy the package instead."],
  [
    "secure co-signer coordination is unavailable for this wallet",
    "Secure co-signer sharing isn't set up for this wallet.",
  ],
  [
    "secure co-signer sharing is unavailable. try again shortly",
    "Secure sharing is unavailable. Try again shortly.",
  ],
  [
    "secure co-signer updates are unavailable. try again shortly",
    "Couldn't check for co-signer updates. Try again shortly.",
  ],
  [
    "secure co-signer updates could not be verified. try again shortly",
    "Couldn't verify the co-signer updates. Try again shortly.",
  ],
  [
    "save a co-signer wallet card before sharing securely",
    "Save a co-signer's wallet card before sharing securely.",
  ],
  ["coordination identity unavailable", "Couldn't read your coordination key. Try again."],
  ["nostr relay update failed", SAVE_FAILED],
  [
    "this intent is too large for secure relay sharing. copy the intent package instead",
    "This transaction is too large to share securely. Copy the package instead.",
  ],
];
