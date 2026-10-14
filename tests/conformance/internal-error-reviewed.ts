/**
 * Reviewed snapshots for the issue 652 conformance checks. Each list is a
 * second, deliberate copy of a production decision: changing the production
 * table without changing this file fails the test, so hiding a message or
 * re-wording a sensitive one always takes two edits and a review.
 */

/**
 * Every copy-table entry whose raw message is sensitive (security, signing,
 * approval, privacy, STRK20, or swap safety), with the sentence it maps to.
 * Each sentence was reviewed to keep the fact or state the reader's move.
 */
export const SENSITIVE_COPY_REVIEWED: readonly (readonly [string, string])[] = [
  [
    "deployed argent account owner does not match the wallet signer",
    "This account's owner key has changed. This phrase can no longer sign for it.",
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
    "braavos account returned a malformed signer list",
    "Couldn't read this account's signers. Try again.",
  ],
  ["rpc returned an invalid account class hash", "Couldn't read this account. Try again."],
  [
    "braavos account class hash is not a release this wallet recognizes",
    "This account runs a release this wallet doesn't recognize. Use it in Braavos.",
  ],
  ["sender origin mismatch", "The wallet refused that request."],
  ["origin blocked", "That site is blocked."],
  ["origin not connected", "That site isn't connected to this wallet."],
  [
    "approval failed",
    "That didn't complete. If it was a transaction, check Activity before trying again.",
  ],
  [
    "transaction approval failed",
    "The approval may not have gone through. Check Activity before trying again.",
  ],
  [
    "approval execution failed",
    "That didn't complete. If it was a transaction, check Activity before trying again.",
  ],
  ["approval not found", "That request has expired. Ask the site to send it again."],
  ["approval no longer pending", "That request was already answered or has expired."],
  [
    "no pending ledger sign for id",
    "That signing request is no longer pending. Check Activity before starting again.",
  ],
  ["approval context changed", "This changed while you were reviewing it. Review it again."],
  ["approval payload changed", "This changed while you were reviewing it. Review it again."],
  ["privacy preparation changed", "This changed while you were reviewing it. Review it again."],
  ["privacy preparation not found", "That review expired. Start again."],
  ["privacy service configuration failed", "Couldn't save that change. Try again."],
  [
    "encrypted store commit state missing",
    "Bramble cannot verify this wallet. Close and reopen Bramble.",
  ],
  [
    "this account's signer setup cannot be recovered with the recovery phrase",
    "This account's signers can't be recovered with the recovery phrase.",
  ],
  [
    "class hash verification unavailable",
    "Couldn't verify this account's contract. Check your connection and try again.",
  ],
  ["unsupported chain", "This wallet doesn't support that network."],
  [
    "rpc endpoint returned the wrong starknet chain",
    "That endpoint reports a different Starknet chain, so nothing was submitted. Check the endpoint under Network → Advanced.",
  ],
  [
    "retry the fee estimate before approving this transaction",
    "Estimate the fee again before approving.",
  ],
  [
    "couldn't estimate the network fee, so nothing was signed. try again.",
    "Couldn't estimate the network fee, so nothing was signed. Try again.",
  ],
  ["allowance not found", "That allowance is no longer on-chain. Refresh the list."],
  [
    "allowance revoke failed",
    "The revoke may not have gone through. Check Activity before trying again.",
  ],
  [
    "switch to the account that granted this allowance",
    "Switch to the account that granted this allowance.",
  ],
  ["swap build failed", "avnu couldn't prepare this swap. Get a fresh quote and try again."],
  [
    "swap build returned a route the wallet could not decode",
    "Couldn't prepare a safe route for this swap. Get a fresh quote.",
  ],
  ["swap build returned more than one swap call", "swap build returned more than one swap call"],
  ["swap build returned no swap call", "swap build returned no swap call"],
  ["swap build returned too many calls", "swap build returned too many calls"],
  [
    "swap build touched an unexpected token approval",
    "Blocked for safety: the swap asked to approve the wrong token. Nothing was signed.",
  ],
  [
    "ledger signing unavailable",
    "Ledger signing isn't available. Reconnect the device and try again.",
  ],
  [
    "complete ledger sign failed",
    "Signing on your Ledger didn't finish. Check Activity before trying again.",
  ],
  ["private balances unavailable", "Couldn't load private balances. Try again."],
  ["strk20 services unavailable", "Private balances are unavailable right now. Try again shortly."],
  [
    "strk20 services unavailable: no shadow account anonymizer is configured for this network",
    "Private services aren't set up for this network.",
  ],
  ["private balances are already active", "Private balances are already active."],
  [
    "private balances are not available for ledger accounts",
    "Private balances aren't available for Ledger accounts.",
  ],
  [
    "private balances are not configured for this network",
    "Private balances aren't set up on this network.",
  ],
  ["activate private balances before sending privately", "Activate private balances first."],
  ["activate private balances before unshielding", "Activate private balances first."],
  ["deploy this account before activating private balances", "Deploy this account first."],
  ["deploy this account before submitting a public private deposit", "Deploy this account first."],
  ["track a token before activating private balances", "Track a token first."],
  [
    "registration requires a network-fee approval",
    "Approve the network fee to finish going private.",
  ],
  ["privacy activation preparation failed", "Couldn't prepare activation. Try again."],
  [
    "private pool fee is unavailable. retry the registration.",
    "Couldn't read the pool fee. Try again.",
  ],
  ["shielding preparation failed", "Couldn't prepare shielding. Try again."],
  ["shielding route unavailable", "No shielding route right now. Try again shortly."],
  ["private send preparation failed", "Couldn't prepare this private send. Try again."],
  [
    "private transaction failed",
    "The private transaction may not have gone through. Check Activity before trying again.",
  ],
  [
    "private sends to the sending account are not supported",
    "You can't send privately to the same account.",
  ],
  [
    "the recipient has not activated private balances",
    "That recipient hasn't activated private balances.",
  ],
  ["enter an amount to shield", "Enter an amount to shield."],
  [
    "shadow account anonymizer changed",
    "This shadow account was made under a different anonymizer, so it can't be checked or swept here. Nothing was sent.",
  ],
  [
    "shadow account holds no tracked token",
    "This shadow account holds none of your tracked tokens. Nothing was sent.",
  ],
  [
    "shadow account scope not recorded",
    "Bramble has no record of this shadow account. Nothing was sent.",
  ],
  [
    "shadow account records unavailable",
    "Couldn't read your shadow account records. Nothing was sent.",
  ],
  [
    "shadow account record limit reached",
    "Bramble can't record another shadow account. Nothing was sent.",
  ],
  ["invalid shadow account record", "This shadow account record isn't valid. Nothing was sent."],
  [
    "shadow sweep batch breaks a batch rule",
    "Couldn't build the sweep: two tracked tokens share one address. Nothing was sent.",
  ],
  ["shadow accounts unavailable", "Couldn't load shadow accounts. Try again."],
  ["shadow account balances unavailable", "Couldn't check balances. Try again."],
  ["shadow account sweep preparation failed", "Couldn't prepare the sweep. Nothing was sent."],
  [
    "argent multisig intent nonce is no longer current",
    "This transaction is out of date. Create a new one.",
  ],
  [
    "argent multisig intent already has its threshold signatures",
    "This transaction already has every signature it needs.",
  ],
  ["this argent multisig signer already signed the intent", "This signer has already signed."],
  [
    "signature is not valid for this exact argent multisig intent",
    "That signature doesn't match this transaction.",
  ],
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
  ["argent multisig signer is already configured", "That signer is already on this multisig."],
  ["argent multisig signer is not configured", "That signer isn't on this multisig."],
  ["argent multisig signers must be unique", "Each signer can only be added once."],
  ["argent multisig removal signers must be unique", "Each signer can only be removed once."],
  [
    "only starknet signers are supported in argent multisig management",
    "Only Starknet signers can be managed on this multisig.",
  ],
  [
    "conflicting argent multisig signer events",
    "Couldn't read this multisig's signer history. Try again.",
  ],
  ["resolve multisig signer account failed", "Couldn't resolve that signer account. Try again."],
  [
    "argent multisig deployment review address mismatch",
    "The reviewed address no longer matches. Check the fee and address again.",
  ],
  [
    "signer set, threshold, and salt do not reproduce the watched multisig address",
    "These signers and threshold don't produce the watched address. Check them.",
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
  ["invalid private key", "Couldn't import that account. Check what you pasted and try again."],
  ["insufficient private balance", "Insufficient private balance"],
  [
    "strk20 services unavailable: submission status is unknown; close every browser window and reopen the browser to recover",
    "strk20 services unavailable: submission status is unknown; close every browser window and reopen the browser to recover",
  ],
  [
    "invalid argent account class hash",
    "This account runs a release this wallet doesn't recognize. Use it in Ready.",
  ],
  [
    "invalid braavos account class hash",
    "This account runs a release this wallet doesn't recognize. Use it in Braavos.",
  ],
  [
    "couldn't estimate the network fee for this swap, so nothing was prepared. the quote may have moved, or the account may not hold enough to cover the swap and its fee. try again, or reduce the amount.",
    "Couldn't estimate the network fee for this swap, so nothing was prepared. The quote may have moved, or the account may not hold enough to cover the swap and its fee. Try again, or reduce the amount.",
  ],
  [
    "this wallet could not confirm that contract is a token, so it will not send a revoke that could approve an nft instead; revoke it from the dapp",
    "Couldn't confirm that contract is a token, so the revoke wasn't sent. Revoke it from the site that asked.",
  ],
  [
    "invalid ledger public key",
    "Your Ledger returned a public key Bramble can't use. Nothing was added.",
  ],
  ["invalid account public key", "That public key isn't valid, so the account wasn't added."],
  [
    "krusty kms signature key mismatch",
    "The signature doesn't match this account's key, so nothing was submitted.",
  ],
  [
    "krusty kms public-key probe did not verify",
    "Bramble couldn't verify its signing key. Nothing was signed.",
  ],
  [
    "ledger signature verification failed",
    "Couldn't verify the signature from your Ledger, so nothing was submitted. Try again.",
  ],
  [
    "signature public key does not match the account",
    "The signature doesn't match this account's key, so nothing was submitted.",
  ],
  [
    "typed data chain does not match the active network",
    "This message is for a different network than the one you're on. Nothing was signed.",
  ],
  [
    "rpc endpoint chain id does not match the account network",
    "That endpoint reports a different Starknet chain, so nothing was submitted. Check the endpoint under Network → Advanced.",
  ],
  ["invalid message hash", "Couldn't compute this request's hash, so nothing was signed."],
  ["invalid transaction hash", "Couldn't compute this request's hash, so nothing was signed."],
  [
    "typed data produced an invalid hash",
    "Couldn't compute this request's hash, so nothing was signed.",
  ],
  ["typed data cannot be hashed", "Couldn't compute this request's hash, so nothing was signed."],
  [
    "invalid swap preparation commitment",
    "This review no longer matches what was prepared. Review it again.",
  ],
  [
    "invalid privacy preparation commitment",
    "This review no longer matches what was prepared. Review it again.",
  ],
  [
    "argent account class hash does not match the pinned release",
    "This contract doesn't match the version Bramble expects, so nothing was submitted.",
  ],
  [
    "argent multisig class hash does not match the pinned release",
    "This contract doesn't match the version Bramble expects, so nothing was submitted.",
  ],
  [
    "deployed argent multisig class does not match the pinned release",
    "This contract doesn't match the version Bramble expects, so nothing was submitted.",
  ],
  [
    "declared argent multisig class does not match the stable pin",
    "This contract doesn't match the version Bramble expects, so nothing was submitted.",
  ],
  [
    "supplied class hash does not match the starknet contract class",
    "This contract doesn't match the version Bramble expects, so nothing was submitted.",
  ],
  [
    "account deployment parameters do not match the stored address",
    "These deployment details don't match this account's address. Nothing was submitted.",
  ],
  [
    "vault migration verification failed",
    "Bramble cannot verify this wallet. Close and reopen Bramble.",
  ],
  [
    "ledger strk20 viewing key unavailable",
    "Couldn't read the private-balance key from your Ledger. Try again.",
  ],
  [
    "ledger strk20 viewing-key limit reached",
    "This Ledger has reached the number of private accounts Bramble can keep.",
  ],
  ["signing key unavailable", "Couldn't prepare this transaction. Try again."],
];
