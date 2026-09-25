package org.bramble.wallet

import org.bramble.wallet.portfolio.rawBalances
import org.bramble.wallet.send.SendFlowModel
import org.bramble.wallet.send.SendHooks

// Balances and Send on [WalletStore], split from WalletStore.kt by behaviour. Main-thread only,
// like the store.

/**
 * A Send journey for the active account, with balances of this view only. Null while locked
 * and for an account the core will not sign for ([sendRefusal]: Braavos, Ready).
 */
fun WalletStore.makeSendModel(): SendFlowModel? {
    val account = activeRecord?.takeIf { sendRefusal(it) == null } ?: return null
    val current = portfolio.rawBalances(networkInfo)
    return SendFlowModel(
        walletCore,
        networkInfo,
        account,
        records.filter {
            it.id != account.id
        },
        current,
        SendHooks(track = { plans += it }) { message, success ->
            showToast(message, positive = success)
        },
    )
}

/**
 * Balances through the portfolio (the one read; a new scope serves saved figures first), then
 * privacy.
 */
suspend fun WalletStore.refreshBalances(ticket: Long = session.ticket()) {
    val account = activeRecord ?: return
    if (!session.isCurrent(ticket)) return
    if (portfolio.scope?.accountId != account.id) {
        portfolio.load(account, networkInfo)
    } else {
        portfolio.refresh(force = true)
    }
    privacy.retain(network, account.id) // one reading per account record, fed into Home's rows
    privacy.refresh(walletCore, networkInfo, account.id)
    portfolio.setPrivacy(privacy.reading, privacy.state)
}
