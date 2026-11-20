package org.bramble.wallet

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.NetworkInfo
import org.bramble.core.SendException
import org.bramble.core.StepReply
import org.bramble.core.activityNeedsObservation
import org.bramble.core.activityObservationPeriodMs
import org.bramble.wallet.send.DeployFlowModel
import org.bramble.wallet.send.SendDriver

// Deployment state, the Deploy account flow and pending-activity reconciliation on [WalletStore],
// twin of the iOS `WalletStore+Send.swift`. Main-thread only, like the store.

/**
 * The standalone Deploy account flow for the active account (Settings' "This account"), or null
 * while locked. The core refuses a class it does not deploy, as the extension does. Its plans are
 * tracked so a lock cancels them.
 */
fun WalletStore.makeDeployModel(): DeployFlowModel? {
    val account = activeRecord ?: return null
    return DeployFlowModel(walletCore, networkInfo, account.id, rpc.transport) { plans += it }
}

/**
 * Refreshes [WalletStore.deployment] (for the Deploy account screen and the privacy gates), and
 * settles pending activity records through the core's status reconciliation (`refreshActivity`:
 * never signs; repeated not-found answers mark a record rejected). Only records the core says are
 * still observed are read, each at most once per observation period, as the extension's
 * `tx-observation.ts`. A result that lands after a lock or an account switch is dropped.
 */
suspend fun WalletStore.refreshSendState(ticket: Long = session.ticket()) {
    val account = activeRecord ?: return
    val network = networkInfo
    val judged = rpc.deploymentState(account.address, network)
    if (session.isCurrent(ticket) && activeRecord?.id == account.id) {
        deployment = judged
        settlePendingActivity(account.id, network, ticket)
    }
}

/** Reads each observed, due record of [accountId] once, then re-reads the activity list. */
private suspend fun WalletStore.settlePendingActivity(
    accountId: String,
    network: NetworkInfo,
    ticket: Long,
) {
    portfolio.reloadActivity()
    val now = System.currentTimeMillis().toULong()
    val period = activityObservationPeriodMs()
    val due =
        portfolio.activityView
            ?.entries
            .orEmpty()
            .filter { record ->
                val last = observedAtMs[record.hash]
                activityNeedsObservation(record, now) && (last == null || now - last >= period)
            }
    for (record in due) {
        if (!session.isCurrent(ticket)) break
        observedAtMs[record.hash] = now
        reconcile(accountId, record.hash, network)
    }
    portfolio.reloadActivity()
}

/** Runs the core's read-only status plan for one recorded [hash]; the store cancels it on lock. */
private suspend fun WalletStore.reconcile(
    accountId: String,
    hash: String,
    network: NetworkInfo,
) {
    val plan =
        try {
            withContext(Dispatchers.Default) { walletCore.refreshActivity(accountId, hash) }
        } catch (ignored: SendException) {
            // Locked, or a record the core no longer holds: nothing to reconcile.
            null
        } ?: return
    plans += plan
    try {
        SendDriver(plan, network, rpc.transport).run(StepReply.Start)
    } catch (ignored: SendException) {
        // Closed by a lock mid-read: the record keeps its status until the next refresh.
    } finally {
        plans -= plan
    }
}
