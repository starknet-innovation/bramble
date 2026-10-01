/**
 * The words the wallet uses when something fails.
 *
 * Split from ./friendly-error.ts the way scripts/copy-policy.ts is split from
 * its checker: that file decides WHICH message a raw error earns, this one
 * holds the messages. Editing the wording should not mean reading the
 * classifier.
 *
 * Every key is a raw diagnostic thrown by the background or the runtime
 * client, lowercased. Those raw strings are deliberately NOT changed at source
 * — they stay the exact text the toast's copy control yields for a bug report,
 * and several are asserted by background tests. This map is the translation
 * layer, so a reader gets a sentence and a reporter still gets the diagnostic.
 *
 * Three keys name secret-material fields ("mnemonic", "seed", "passphrase")
 * because that is what the background threw; they are matched here and never
 * read, logged, or persisted.
 *
 * A message earns its own line when the reader can do something specific about
 * it. Where two failures leave the reader with the same move, they share one
 * sentence — a dozen ways to say "try again" is how a wallet starts reading
 * like it was generated rather than written.
 */

import { WRONG_CHAIN_MESSAGE } from "@bramble/starknet/provider";

/** Shown when a request was malformed rather than refused. */
export const GENERIC_VALIDATION =
  "Something about that request wasn't right. Check the details and try again.";
// Shown whenever the vault is locked or the worker is not answering.
const WALLET_UNAVAILABLE = "The wallet is locked or unavailable. Unlock it and try again.";
// Shown for transport failures, where the reader's move is their connection.
const NETWORK_UNREACHABLE = "Couldn't reach the network. Check your connection and try again.";
/** The last resort, when nothing else classified the error. */
export const UNEXPECTED_FALLBACK = "Something went wrong. Please try again.";
/** Shown for a raw RPC rejection, whose detail belongs behind the copy control. */
export const RPC_REJECTED =
  "The RPC rejected this request. Copy the error details for the full response.";
/** Shown for a raw service rejection, same reasoning as the RPC one. */
export const SERVICE_REJECTED =
  "A wallet service rejected this request. Copy the error details for the full response.";
/** Shown when an endpoint is throttling us rather than refusing us. */
export const RATE_LIMITED = "This service is rate limiting requests. Wait a moment and try again.";

// Shared endings. A failure the reader cannot diagnose gets the same sentence
// wherever it comes from, so the wallet sounds like one writer.
const SAVE_FAILED = "Couldn't save that change. Try again.";
const REQUEST_FAILED = "That request didn't go through. Try again.";
const REVIEW_MOVED = "This changed while you were reviewing it. Review it again.";
const FEE_MOVED = "The fee changed while you were reviewing. Check it and submit again.";
const SWAP_ROUTE_UNSAFE = "Couldn't prepare a safe route for this swap. Get a fresh quote.";
const REFUSED = "The wallet refused that request.";
const MULTISIG_DEPLOY_PREPARE = "Couldn't prepare the deployment. Try again.";
const MULTISIG_BALANCES = "Couldn't load multisig balances. Check your connection and try again.";
const OUTCOME_UNKNOWN = "The result is unknown. Check Activity before trying again.";
// Catch-alls around a submission. The wallet doesn't know whether the
// transaction left the device, so the copy must not claim it failed or invite
// a retry that could send it twice.
const SUBMISSION_UNKNOWN = (what: string): string =>
  `${what} may not have gone through. Check Activity before trying again.`;
// The router's own catch-all can wrap a submission, so it says the same.
const REQUEST_UNKNOWN =
  "That didn't complete. If it was a transaction, check Activity before trying again.";
const LEDGER_RETRY = "Couldn't reach your Ledger. Reconnect the device and try again.";
const ACTIVATE_FIRST = "Activate private balances first.";
const DEPLOY_FIRST = "Deploy this account first.";

/**
 * Raw diagnostic (lowercased) to the sentence a reader sees.
 *
 * Argent multisig diagnostics are deliberately absent: they are reviewed with
 * the multisig journey, which owns the vocabulary they belong to.
 */
export const ERROR_COPY: ReadonlyMap<string, string> = new Map([
  // --- Transport and worker ------------------------------------------------
  ["wallet unavailable", WALLET_UNAVAILABLE],
  ["wallet locked", WALLET_UNAVAILABLE],
  ["failed to fetch", NETWORK_UNREACHABLE],
  ["network error", NETWORK_UNREACHABLE],
  ["load failed", NETWORK_UNREACHABLE],
  ["wallet lock incomplete", "Couldn't lock the wallet. Try again."],

  // --- Requests the wallet would not carry out -----------------------------
  // Protocol-level refusals. A reader cannot act on which guard fired, and
  // naming the guard would only tell an attacker which one they tripped.
  ["privileged sender required", REFUSED],
  ["untrusted sender", REFUSED],
  ["unsupported message", REFUSED],
  ["sender origin mismatch", REFUSED],
  ["origin blocked", "That site is blocked."],
  ["origin not connected", "That site isn't connected to this wallet."],
  ["request rejected", "That request was rejected."],
  ["dapps cannot call the wallet account contract itself", "A site can't call your own account."],
  ["approval failed", REQUEST_FAILED],
  ["approval execution failed", REQUEST_UNKNOWN],
  ["wallet request failed", REQUEST_UNKNOWN],
  ["approval not found", "That request has expired. Ask the site to send it again."],
  [
    "no pending ledger sign for id",
    "That signing request is no longer pending. Check Activity before starting again.",
  ],

  // --- Something moved while the reader was reading it ---------------------
  ["approval context changed", REVIEW_MOVED],
  ["approval payload changed", REVIEW_MOVED],
  ["privacy preparation changed", REVIEW_MOVED],
  ["swap preparation changed", REVIEW_MOVED],
  ["a newer fee estimate replaced this one", FEE_MOVED],
  ["the fee changed since this request was reviewed", FEE_MOVED],
  ["privacy preparation not found", "That review expired. Start again."],
  ["swap preparation not found", "That swap review expired. Get a fresh quote."],
  [
    "swap quote is not reviewable — request a fresh price",
    "That quote is out of date. Get a fresh price.",
  ],

  // --- Settings and preferences --------------------------------------------
  ["display update failed", SAVE_FAILED],
  ["label update failed", SAVE_FAILED],
  ["rpc endpoint update failed", SAVE_FAILED],
  ["explorer fallback update failed", SAVE_FAILED],
  ["privacy service configuration failed", SAVE_FAILED],
  ["token visibility update failed", SAVE_FAILED],
  ["preferences unavailable", "Couldn't load your settings. Try again."],
  ["diagnostic export failed", "Couldn't export diagnostics. Try again."],
  ["backup import failed", "Couldn't read that backup file. Check the file and try again."],

  // --- Folders (the UI word; the code still says group) --------------------
  ["group create failed", "Couldn't create that folder. Try again."],
  ["group rename failed", "Couldn't update that folder. Try again."],
  ["group icon update failed", "Couldn't update that folder. Try again."],
  ["group membership update failed", "Couldn't move that account. Try again."],
  ["group remove failed", "Couldn't delete that folder. Try again."],

  // --- Address book --------------------------------------------------------
  ["address save failed", "Couldn't save that address. Try again."],
  ["address removal failed", "Couldn't remove that address. Try again."],

  // --- Accounts ------------------------------------------------------------
  ["account switch failed", "Couldn't switch accounts. Try again."],
  ["add account failed", "Couldn't add that account. Try again."],
  ["import account failed", "Couldn't import that account. Check what you pasted and try again."],
  ["create key vault failed", "Couldn't create your wallet. Try again."],
  ["seed import failed", "Couldn't import that recovery phrase. Check the words and try again."],
  ["mnemonic validation unavailable", "Couldn't check that recovery phrase. Try again."],
  ["reveal failed", "Couldn't reveal that. Re-enter your passphrase and try again."],
  ["incorrect passphrase", "That passphrase is wrong."],
  [
    "account discovery unavailable",
    "Couldn't search for accounts. Check your connection and try again.",
  ],
  [
    "account discovery is unavailable",
    "Couldn't search for accounts. Check your connection and try again.",
  ],
  [
    "account recovery unavailable",
    "Couldn't recover accounts. Check your connection and try again.",
  ],
  ["account preview unavailable", "Couldn't preview that account. Try again."],
  [
    "class hash verification unavailable",
    "Couldn't verify this account's contract. Check your connection and try again.",
  ],
  ["account already deployed", "This account is already deployed."],
  ["deployment failed", SUBMISSION_UNKNOWN("The deployment")],
  ["deployment data not available", "Couldn't read this account's deployment details. Try again."],
  ["no account for selected network", "No account on this network yet. Add one to continue."],

  // --- Networks and endpoints ----------------------------------------------
  ["network switch failed", "Couldn't switch networks. Try again."],
  ["unsupported chain", "This wallet doesn't support that network."],
  ["unsupported api version", "That endpoint speaks an API version this wallet can't use."],
  [
    WRONG_CHAIN_MESSAGE.toLowerCase(),
    "That endpoint reports a different Starknet chain, so nothing was submitted. Check the endpoint under Network → Advanced.",
  ],
  ["switch to the deployment network first", "Switch to that account's network to deploy it."],
  [
    "switch to the participant account network first",
    "Switch to that participant's network first.",
  ],

  // --- Balances, tokens and activity ---------------------------------------
  ["balance snapshot unavailable", "Couldn't load balances. Check your connection and try again."],
  ["balances unavailable", "Couldn't load balances. Check your connection and try again."],
  ["activity scope unavailable", "Couldn't load activity for this account. Try again."],
  ["add token failed", "Couldn't add that token. Check the contract address and try again."],
  ["token detection failed", "Couldn't scan for tokens. Check your connection and try again."],
  ["token list unavailable", "Couldn't load the token list. Check your connection and try again."],
  ["token unavailable", "That token isn't available on this network."],
  ["token unavailable on this network", "That token isn't available on this network."],
  ["unsupported token symbol", "That token symbol isn't supported."],
  [
    "fee estimate failed",
    "Couldn't estimate the network fee. Check your connection and try again.",
  ],
  [
    "retry the fee estimate before approving this transaction",
    "Estimate the fee again before approving.",
  ],
  // Already the sentence a reader needs. Listed so the coverage check can tell
  // "reviewed and kept" from "never looked at".
  [
    "couldn't estimate the network fee, so nothing was signed. try again.",
    "Couldn't estimate the network fee, so nothing was signed. Try again.",
  ],

  // --- Allowances ----------------------------------------------------------
  ["allowance not found", "That allowance is no longer on-chain. Refresh the list."],
  ["revoke failed", "The revoke didn't go through. Try again."],
  [
    "switch to the account that granted this allowance",
    "Switch to the account that granted this allowance.",
  ],
  [
    "this contract is an nft collection, not a token; revoke it from the dapp",
    "That's a collectible contract, not a token. Revoke it from the site that asked.",
  ],

  // --- Collectibles --------------------------------------------------------
  ["this account does not own that nft", "This account doesn't own that collectible."],
  [
    "switch to the nft's network first",
    "This collectible is on another network. Switch networks to move it.",
  ],
  ["invalid watch asset metadata", "That site sent token details this wallet can't read."],
  ["add nft failed", "Couldn't add that collectible. Check the contract address and try again."],
  ["remove nft failed", "Couldn't remove that collectible. Try again."],
  ["nft update failed", "Couldn't update that collectible. Try again."],
  ["nft transfer review failed", "Couldn't prepare this transfer. Try again."],
  ["nft transfer failed", SUBMISSION_UNKNOWN("The transfer")],

  // --- Send ----------------------------------------------------------------
  ["transfer failed", SUBMISSION_UNKNOWN("The transfer")],
  ["transfer review failed", "Couldn't prepare this transfer. Try again."],
  ["recipient check unavailable", "Couldn't check that recipient. Try again."],
  ["enter an amount to send", "Enter an amount to send."],
  ["enter a valid starknet address", "Enter a valid Starknet address."],
  ["amount is outside the starknet field range", "That amount is too large."],

  // --- Swap ----------------------------------------------------------------
  ["swap failed", SUBMISSION_UNKNOWN("The swap")],
  ["swap preparation failed", "Couldn't prepare this swap. Get a fresh quote and try again."],
  ["swap quote failed", "Couldn't fetch a quote. Check your connection and try again."],
  ["swap build failed", "avnu couldn't prepare this swap. Get a fresh quote and try again."],
  ["swaps are not available on this network", "Swaps aren't available on this network."],
  [
    "no swap route available for this pair",
    "No route found for this pair right now. Try a different amount or pair.",
  ],
  ["swap build returned a route the wallet could not decode", SWAP_ROUTE_UNSAFE],
  ["swap build returned more than one swap call", SWAP_ROUTE_UNSAFE],
  ["swap build returned no swap call", SWAP_ROUTE_UNSAFE],
  ["swap build returned too many calls", SWAP_ROUTE_UNSAFE],
  [
    "swap build touched an unexpected token approval",
    "Blocked for safety: the swap asked to approve the wrong token. Nothing was signed.",
  ],
  ["enter an amount to swap", "Enter an amount to swap."],
  ["pick two different tokens", "Pick two different tokens."],

  // --- Signing -------------------------------------------------------------
  ["invalid typed data", "That site sent data this wallet can't read."],
  [
    "ledger signing unavailable",
    "Ledger signing isn't available. Reconnect the device and try again.",
  ],
  // One move answers all four: reconnect the device.
  ["add ledger account failed", LEDGER_RETRY],
  ["create ledger wallet failed", LEDGER_RETRY],
  ["derive ledger accounts failed", LEDGER_RETRY],
  [
    "complete ledger sign failed",
    "Signing on your Ledger didn't finish. Check Activity before trying again.",
  ],

  // --- Private balances ----------------------------------------------------
  ["private balances unavailable", "Couldn't load private balances. Try again."],
  ["strk20 services unavailable", "Private balances are unavailable right now. Try again shortly."],
  ["private balances are already active", "Private balances are already active."],
  [
    "private balances are not available for ledger accounts",
    "Private balances aren't available for Ledger accounts.",
  ],
  [
    "private balances are not configured for this network",
    "Private balances aren't set up on this network.",
  ],
  ["activate private balances before sending privately", ACTIVATE_FIRST],
  ["activate private balances before unshielding", ACTIVATE_FIRST],
  ["deploy this account before activating private balances", DEPLOY_FIRST],
  ["deploy this account before submitting a public private deposit", DEPLOY_FIRST],
  ["track a token before activating private balances", "Track a token first."],
  [
    "registration requires a network-fee approval",
    "Approve the network fee to finish going private.",
  ],
  [
    "a registration is already on its way for this account",
    "A registration is already on its way for this account.",
  ],
  ["privacy activation preparation failed", "Couldn't prepare activation. Try again."],
  [
    "private pool fee is unavailable. retry the registration.",
    "Couldn't read the pool fee. Try again.",
  ],
  ["shielding preparation failed", "Couldn't prepare shielding. Try again."],
  ["shielding route unavailable", "No shielding route right now. Try again shortly."],
  ["unshielding preparation failed", "Couldn't prepare unshielding. Try again."],
  ["private send preparation failed", "Couldn't prepare this private send. Try again."],
  ["private transaction failed", SUBMISSION_UNKNOWN("The private transaction")],
  [
    "private sends to the sending account are not supported",
    "You can't send privately to the same account.",
  ],
  [
    "the recipient has not activated private balances",
    "That recipient hasn't activated private balances.",
  ],
  ["enter an amount to shield", "Enter an amount to shield."],
  ["enter an amount to unshield", "Enter an amount to unshield."],
  [
    "the previous submission did not reach starknet. try again.",
    "The last submission didn't reach Starknet. Try again.",
  ],

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
]);
