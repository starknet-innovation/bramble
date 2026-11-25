package org.bramble.wallet.allowances

import org.bramble.core.AllowanceNotice
import org.bramble.core.AllowanceSource
import org.bramble.core.AllowanceView

/**
 * The allowance manager's words and row lines, as the extension's `allowance-views.ts` and the
 * `portfolio.allowance.*` catalog; twin of the iOS `AllowanceCopy`. Pure over the core's
 * [AllowanceView], so the JVM tests hold it to the copy. Review, risk and refusal sentences are not
 * here: those are the core's own ([RevokeFlowModel]).
 */
internal object AllowanceCopy {
    const val TITLE = "Allowances"
    const val SETTINGS_SECTION = "Access & permissions"
    const val SETTINGS_ROW = "Token allowances"
    const val LEDE = "Revoking sets a spender's allowance to zero after you confirm its network fee."
    const val REFRESH = "Refresh allowances"
    const val LOADING = "Loading allowances…"
    const val NO_ACCOUNT = "Unlock an account on this network to manage allowances."
    const val NONE = "No allowances on tokens you track."
    const val NOT_LOADED = "Not loaded"
    const val UNAVAILABLE = "Allowances could not be loaded. Refresh to try again."
    const val OUTSTANDING = "{count} outstanding"
    const val SCOPE_TITLE = "What this list includes"
    const val SCOPE_BODY =
        "It includes approvals granted here and approvals discovered on-chain for tracked ERC-20 tokens. " +
            "'At least' means the wallet can only prove a lower bound. NFT approvals and untracked tokens are " +
            "outside this scan; unconfirmed contracts keep no revoke control because an ERC-20 revoke call " +
            "could grant an NFT instead."
    const val COPY_SPENDER = "Copy spender address"
    const val COPY_TOKEN_CONTRACT = "Copy token contract address"
    const val REVOKE = "Revoke"
    const val REVOKING = "Revoke sent. It stays listed until the network confirms it."
    const val SUBMITTED = "Revoke submitted"
    const val UNCONFIRMED_TOKEN =
        "This wallet cannot confirm this contract is a token, so the value may be an NFT item id rather " +
            "than an amount. Revoke it from the site that asked for it."
    const val UNLIMITED = "Unlimited"
    const val UNKNOWN_AMOUNT = "an unknown amount"
    const val AT_LEAST = "at least {amount}"
    const val BASE_UNITS = "{amount} base units"
    const val OF = "of"
    const val SOURCE_CHAIN = "on-chain"
    const val SOURCE_MULTISIG = "granted by a multisig you sign for"
    const val SOURCE_WALLET = "this wallet"
    const val MULTISIG_UNREAD = "A watched multisig could not be read, so approvals it granted may be missing."
    const val RETENTION_FULL =
        "This wallet keeps {count} approvals per account and drops the smallest first, so some may be missing."
    const val SCAN_INCOMPLETE = "This list may be incomplete. Some older approvals on your tokens could not be checked."
    const val SPENDER_ROW = "Spender"
    const val TOKEN_ROW = "Token"
    const val AMOUNT_ROW = "Allowance"

    /**
     * `ALLOWANCE_LIMITS.entriesPerScope` (the core's `ALLOWANCE_POLICY.entries_per_scope`). The core
     * does not export it in v0.7.0, so the notice's number is the extension's, held here.
     */
    const val ENTRIES_PER_SCOPE = 50

    /**
     * 2^128 - 1: `isUnlimitedAllowance`'s cut-off. The core does not export the judge in v0.7.0;
     * `AllowanceCopyTest` holds this to the fixture's `unlimited` block.
     */
    private const val UNLIMITED_FLOOR = "340282366920938463463374607431768211455"

    /** `isUnlimitedAllowance`: a plain base-10 amount at or above 2^128 - 1. */
    fun isUnlimited(amount: String): Boolean {
        if (amount.isEmpty() || !amount.all { it in '0'..'9' }) return false
        val digits = amount.trimStart('0')
        return if (digits.length != UNLIMITED_FLOOR.length) {
            digits.length > UNLIMITED_FLOOR.length
        } else {
            digits >= UNLIMITED_FLOOR
        }
    }

    /**
     * `amountLabel`: unlimited wins; a lower bound says so, and a bound of zero is unknown.
     * [display] is `displayAmount` (the token's units, or raw base units said so).
     */
    fun amount(
        view: AllowanceView,
        display: (String) -> String,
    ): String =
        when {
            isUnlimited(view.amount) -> UNLIMITED
            !view.lowerBound -> display(view.amount)
            view.amount == "0" -> UNKNOWN_AMOUNT
            else -> AT_LEAST.replace("{amount}", display(view.amount))
        }

    /** `sourceLabel`. */
    fun source(source: AllowanceSource): String =
        when (source) {
            AllowanceSource.EXTERNAL -> SOURCE_CHAIN
            AllowanceSource.MULTISIG -> SOURCE_MULTISIG
            AllowanceSource.WALLET -> SOURCE_WALLET
        }

    /** `noticeCopy`. */
    fun notice(notice: AllowanceNotice): String =
        when (notice) {
            AllowanceNotice.MULTISIG_UNREAD -> MULTISIG_UNREAD
            AllowanceNotice.RETENTION_FULL -> RETENTION_FULL.replace("{count}", ENTRIES_PER_SCOPE.toString())
            AllowanceNotice.SCAN_INCOMPLETE -> SCAN_INCOMPLETE
        }

    /** The header's count: nothing while reading, "Not loaded" without an answer. */
    fun subtitle(count: Int?): String? = count?.let { OUTSTANDING.replace("{count}", it.toString()) }

    /**
     * A multisig's grant takes its own intent; an unconfirmed contract would be granted, not
     * revoked. Neither row gets the control.
     */
    fun canRevoke(view: AllowanceView): Boolean = view.source != AllowanceSource.MULTISIG && !view.unconfirmedToken
}
