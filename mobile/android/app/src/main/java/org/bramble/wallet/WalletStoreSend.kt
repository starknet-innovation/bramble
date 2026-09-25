package org.bramble.wallet

import org.bramble.wallet.portfolio.rawBalances
import org.bramble.wallet.privacy.refreshPrivacy
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
 * deployment and pending activity ([refreshSendState]), then privacy.
 */
suspend fun WalletStore.refreshBalances(ticket: Long = session.ticket()) {
    val account = activeRecord?.takeIf { session.isCurrent(ticket) } ?: return
    if (portfolio.scope?.accountId != account.id) {
        portfolio.load(account, networkInfo)
    } else {
        portfolio.refresh(force = true)
    }
    // Deployment feeds the deploy notice and the privacy gates, so it is read before privacy.
    refreshSendState(ticket)
    // One private reading per account record, fed into Home's rows.
    if (session.isCurrent(ticket) && activeRecord?.id == account.id) refreshPrivacy()
}
