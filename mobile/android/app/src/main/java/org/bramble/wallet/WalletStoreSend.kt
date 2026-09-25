package org.bramble.wallet

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.bramble.core.ActivityEntry
import org.bramble.core.NetworkInfo
import org.bramble.core.SendException
import org.bramble.core.StepReply
import org.bramble.core.WalletCore
import org.bramble.core.activityNeedsObservation
import org.bramble.core.activityObservationPeriodFor
import org.bramble.core.activityObservationPeriodMs
import org.bramble.wallet.portfolio.rawBalances
import org.bramble.wallet.send.SendDriver
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
    observeActivity(ticket)
}

private fun wallNowMs(): ULong = System.currentTimeMillis().toULong()

/**
 * One observation pass over the active account's records, as the extension's
 * `tx-observation.ts` and the iOS `observeActivity`: only records the core says are still observed
 * are read (unresolved ones for an hour, accepted ones awaiting L1 for seven days), each at most
 * once per its tier's period, through the core's status reconciliation (a `refreshActivity` plan,
 * which never signs). Then the core retires records that outlived their hour and hands out the
 * notices owed, each shown once as an error toast, as the side panel does. Runs its core calls on
 * `Dispatchers.Default` without marking the store busy, and drops everything once [ticket] is
 * stale (a lock landed).
 */
suspend fun WalletStore.observeActivity(ticket: Long = session.ticket()) {
    val account = activeRecord ?: return
    val network = networkInfo
    val core = walletCore
    val now = wallNowMs()
    val due =
        activityOrEmpty(core, account.id).filter { record ->
            val last = observedAtMs[record.hash]
            activityNeedsObservation(record, now) &&
                (last == null || now - last >= activityObservationPeriodFor(record))
        }
    for (record in due) {
        if (!session.isCurrent(ticket)) break
        observedAtMs[record.hash] = now
        settleRecord(core, network, account.id, record.hash)
    }
    if (!session.isCurrent(ticket)) return
    portfolio.reloadActivity()
    val notices =
        try {
            withContext(Dispatchers.Default) { core.takeActivityNotices(account.id, wallNowMs()) }
        } catch (ignored: SendException) {
            emptyList()
        }
    // One toast slot: with several owed notices the latest shows; every record keeps its status.
    if (session.isCurrent(ticket)) notices.lastOrNull()?.let { showToast(it) }
}

/** The account's activity from the core's log; empty when locked or the account is unknown. */
private suspend fun activityOrEmpty(
    core: WalletCore,
    accountId: String,
): List<ActivityEntry> =
    try {
        withContext(Dispatchers.Default) { core.activity(accountId) }
    } catch (ignored: SendException) {
        emptyList()
    }

/** Runs one `refreshActivity` plan to its end; a refused step (a lock, an unknown hash) ends it. */
private suspend fun WalletStore.settleRecord(
    core: WalletCore,
    network: NetworkInfo,
    accountId: String,
    hash: String,
) {
    val plan =
        try {
            withContext(Dispatchers.Default) { core.refreshActivity(accountId, hash) }
        } catch (ignored: SendException) {
            return
        }
    plans += plan
    try {
        SendDriver(plan, network).run(StepReply.Start)
    } catch (ignored: SendException) {
        // The record keeps its status; the next pass reads it again.
    } finally {
        plan.close()
        plans -= plan
    }
}

/**
 * Runs [observeActivity] every `activityObservationPeriodMs()` (the fast period, the shortest any
 * record is read at) while the wallet is open: the foreground stand-in for the extension's two
 * observation alarms. Replaces any running ticker; [WalletStore.lock] cancels it.
 */
fun WalletStore.startActivityObservation() {
    observationTicker?.cancel()
    val period = activityObservationPeriodMs().toLong()
    observationTicker =
        appScope.launch {
            while (isActive) {
                delay(period)
                if (route == Route.WALLET) observeActivity()
            }
        }
}
