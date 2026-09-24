package org.bramble.wallet

import org.bramble.core.TokenInfo
import org.bramble.core.formatTokenAmount

// Balances for display, from the portfolio's one balance read (`PortfolioStore`); the store no
// longer reads STRK/ETH on its own. Uncompiled: checked against the generated Kotlin bindings.

/** Base-unit balance of a network token formatted for display, or null until it has loaded. */
fun WalletStore.amount(token: TokenInfo): String? {
    val raw = portfolio.rawBalances(networkInfo)[token.symbol] ?: return null
    return runCatching { formatTokenAmount(raw, token.decimals, 4u) }.getOrNull()
}

/** `strkAvailableForFees`: null until the public balances have loaded (privacy gates). */
val WalletStore.strkFunded: Boolean?
    get() = portfolio.rawBalances(networkInfo)["STRK"]?.let { it.trimStart('0').isNotEmpty() }
