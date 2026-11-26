package org.bramble.wallet

import org.bramble.wallet.portfolio.balance
import org.bramble.wallet.swap.SwapFlowModel

// The Swap journey on [WalletStore], twin of the iOS `WalletStore+Swap.swift`. Main-thread only.

/**
 * A Swap journey for the active account, or null while locked. [startToken] (a tracked token id)
 * opens it selling that token (a token screen's Swap). Quotes and builds travel the portfolio's
 * bounded HTTP path; the plan travels the send transport and is tracked, so a lock cancels it.
 */
fun WalletStore.makeSwapModel(startToken: String? = null): SwapFlowModel? {
    val account = activeRecord ?: return null
    val held =
        portfolio.tracked
            .mapNotNull { tracked -> portfolio.balance(tracked.token)?.let { tracked.token.id to it.balance } }
            .toMap()
    return SwapFlowModel(
        walletCore,
        networkInfo,
        account,
        portfolio.preferences,
        held,
        portfolio.priceView,
        startToken,
        http = portfolio.transport,
        rpc = rpc.transport,
    ) { plans += it }
}
