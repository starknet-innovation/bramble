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

import { MULTISIG_ERROR_COPY } from "./friendly-error-copy-multisig";
import { SAVE_FAILED, SUBMISSION_UNKNOWN } from "./friendly-error-shared";

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
const REQUEST_FAILED = "That request didn't go through. Try again.";
const REVIEW_MOVED = "This changed while you were reviewing it. Review it again.";
const FEE_MOVED = "The fee changed while you were reviewing. Check it and submit again.";
const SWAP_ROUTE_UNSAFE = "Couldn't prepare a safe route for this swap. Get a fresh quote.";
const REFUSED = "The wallet refused that request.";
// Catch-alls around a submission. The wallet doesn't know whether the
// transaction left the device, so the copy must not claim it failed or invite
// a retry that could send it twice.
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

  // --- Accounts this wallet can watch but not sign for ----------------------
  // The recovery scan labels these rows view-only up front (issue 542); this
  // table covers the authoritative transaction-path refusals behind them.
  [
    "deployed argent account guardian is not supported by this wallet",
    "This account has a guardian, a second approver this wallet can't provide. Use it in Ready, or remove the guardian there.",
  ],
  [
    "deployed argent account owner does not match the wallet signer",
    "This account's owner key has changed. This phrase can no longer sign for it.",
  ],
  [
    "deployed argent account owner type is not supported by this wallet",
    "This account signs with a method this wallet doesn't support. Use it in Ready.",
  ],
  [
    "deployed argent account class is not a release this wallet recognizes",
    "This account runs a release this wallet doesn't recognize. Use it in Ready.",
  ],
  [
    "deployed argent account class expects an authorization format this wallet does not produce",
    "This account runs an older Argent release. Upgrade it in Ready to use it here.",
  ],
  [
    "deployed braavos account has an active 2fa signer",
    "This account has 2FA, a device signature this wallet can't provide. Use it in Braavos.",
  ],
  [
    "deployed braavos account owner does not match the wallet signer",
    "This account's signing key has changed. This phrase can no longer sign for it.",
  ],
  [
    "deployed braavos account class is not a release this wallet recognizes",
    "This account runs a release this wallet doesn't recognize. Use it in Braavos.",
  ],
  [
    "braavos account returned a malformed signer list",
    "Couldn't read this account's signers. Try again.",
  ],
  ["rpc returned an invalid account class hash", "Couldn't read this account. Try again."],
  [
    "braavos account class hash is not a release this wallet recognizes",
    "This account runs a release this wallet doesn't recognize. Use it in Braavos.",
  ],
  [
    "this wallet does not deploy braavos accounts",
    "This wallet can't deploy Braavos accounts yet. Deploy it in Braavos first.",
  ],

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
  // A vault the background cannot verify shows the recovery gate; these reach
  // the user only if its state changed between the status read and the submit.
  [
    "encrypted store commit state missing",
    "Bramble cannot verify this wallet. Close and reopen Bramble.",
  ],
  [
    "encrypted store rollback detected",
    "Bramble cannot verify this wallet. Close and reopen Bramble.",
  ],
  [
    "encrypted store is not awaiting recovery",
    "This wallet no longer needs Unlock anyway. Close and reopen Bramble.",
  ],
  [
    "account discovery unavailable",
    "Couldn't search for accounts. Check your connection and try again.",
  ],
  [
    "account discovery is unavailable",
    "Couldn't search for accounts. Check your connection and try again.",
  ],
  // A wallet set up from a device or a pasted key has no phrase to rescan, so
  // the search has nothing to work from and the reader cannot fix it here.
  [
    "this wallet has no recovery phrase to scan",
    "This wallet was set up without a recovery phrase, so there is nothing to search for.",
  ],
  [
    "account recovery unavailable",
    "Couldn't recover accounts. Check your connection and try again.",
  ],
  // The 2FA / guardian removal flow's own fallbacks (runtime-recovery.ts and
  // account-recovery.ts), worded apart from the account-discovery flow above.
  [
    "second factor removal unavailable",
    "Couldn't load 2FA or guardian removal. Check your connection and try again.",
  ],
  [
    "second factor removal unconfirmed",
    "Couldn't confirm the 2FA or guardian removal. Check activity before trying again.",
  ],
  [
    "deployed argent account class is not one this wallet can recover",
    "This account runs a Ready release this wallet can't recover. Use it in Ready.",
  ],
  [
    "this account's signer setup cannot be recovered with the recovery phrase",
    "This account's signers can't be recovered with the recovery phrase.",
  ],
  // The account's own limit (TIME_BETWEEN_TWO_ESCAPES), checked before the
  // escape is estimated, and a failed read of its clock (fail closed).
  [
    "this account allows one escape attempt every 12 hours",
    "This account allows one escape attempt every 12 hours. Try again later.",
  ],
  [
    "could not check this account's escape limit",
    "Couldn't check this account's escape limit. Try again.",
  ],
  // argent-recovery.ts fails closed on an escape it cannot decode.
  [
    "the account reported an unrecognised escape",
    "This account reported a guardian state this wallet can't read. Use it in Ready.",
  ],
  [
    "the account reported an unrecognised escape status",
    "This account reported a guardian state this wallet can't read. Use it in Ready.",
  ],
  [
    "the account reported an unrecognised escape type",
    "This account reported a guardian state this wallet can't read. Use it in Ready.",
  ],
  // Removing 2FA or a guardian is a phrase flow; a Ledger account is refused
  // before any device prompt (account-recovery.ts).
  [
    "account recovery is not available for ledger accounts",
    "Removing 2FA or a guardian isn't available for Ledger accounts.",
  ],
  // A Ready account with a backup guardian cannot escape its guardian to none
  // (argent-recovery.ts refuses before the account would revert).
  [
    "this account has a backup guardian, so the guardian cannot be removed with the recovery phrase",
    "This account has a backup guardian, so the recovery phrase can't remove its guardian.",
  ],
  [
    "could not check this account's backup guardian",
    "Couldn't check this account's backup guardian. Try again.",
  ],
  // The confirmation was reviewed for another account than the active one.
  [
    "the active account changed. review the recovery again.",
    "You switched accounts. Review the recovery again.",
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

  ...MULTISIG_ERROR_COPY,
]);
