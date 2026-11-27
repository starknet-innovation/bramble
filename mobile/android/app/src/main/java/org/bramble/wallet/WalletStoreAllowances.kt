package org.bramble.wallet

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.bramble.core.AllowanceList
import org.bramble.core.AllowanceView
import org.bramble.core.CoreException
import org.bramble.core.NetworkInfo
import org.bramble.core.RpcReply
import org.bramble.core.RpcRequest
import org.bramble.core.ScanStep
import org.bramble.core.TokenConfig
import org.bramble.wallet.allowances.RevokeFlowModel
import org.bramble.wallet.allowances.RevokeLinks
import org.bramble.wallet.portfolio.PortfolioReads
import org.bramble.wallet.portfolio.rawBalances

// The allowance manager on [WalletStore] (Settings › Token allowances), twin of the iOS
// `WalletStore+Allowances.swift`, mirroring the extension's `wallet.allowances` and
// `wallet.revokeAllowance` handlers. The core lists, settles and plans; this file only drives its
// reads and opens the revoke over the Send driver. Main-thread only, like the store.

/** The listing's reads: discovery, then the tracked amounts. Each may be given up once. */
private const val LISTING_READS = 2

/**
 * The sans-IO reads the allowance exports share (`AllowanceListing`, `AllowanceRevoke`): the core
 * decides every call and judges every reply; the host only moves the bytes.
 */
internal data class AllowanceReads(
    val next: () -> List<RpcRequest>,
    val accept: (RpcReply) -> ScanStep,
    val restart: () -> Unit,
)

/**
 * Runs [reads]' current read on the first verified endpoint that answers it, replaying it from
 * the start on the next after a transport failure. False when no endpoint answered.
 */
internal suspend fun PortfolioReads.drive(
    reads: AllowanceReads,
    network: NetworkInfo,
): Boolean = firstAnswer(network) { url -> readAt(reads, url) } ?: false

/** One pass of [reads]' current read against [url]; null after a transport failure there. */
private suspend fun PortfolioReads.readAt(
    reads: AllowanceReads,
    url: String,
): Boolean? {
    reads.restart()
    var calls = reads.next()
    while (calls.isNotEmpty()) {
        if (sendAll(calls, url).any { reads.accept(it) == ScanStep.TRANSPORT }) return null
        calls = reads.next()
    }
    return true
}

/**
 * Reads a listing for the active account over its network's trusted tokens: the discovery scan,
 * then the live amount of every tracked grant. A read no endpoint answers is given up, so the core
 * lists what it can and says the list is partial (`SCAN_INCOMPLETE`). Null when the core refused
 * the listing (locked, an unknown account): nothing is vouched for.
 */
suspend fun WalletStore.loadAllowances(): AllowanceList? {
    val account = activeRecord ?: return null
    val network = networkInfo
    val reads = portfolio.reads
    return try {
        val listing =
            withContext(Dispatchers.Default) { walletCore.allowanceListing(account.id, portfolio.preferences) }
        val driven = AllowanceReads(listing::nextCalls, listing::accept, listing::restart)
        var givenUp = 0
        while (givenUp < LISTING_READS && !reads.drive(driven, network)) {
            listing.giveUp()
            givenUp++
        }
        listing.finish()
    } catch (ignored: CoreException) {
        null
    }
}

/** The tracked tokens on this network, for the rows' units. */
val WalletStore.allowanceTokens: List<TokenConfig>
    get() = portfolio.preferences.tracked(networkInfo.network).map { it.token }

/** A revoke of [allowance] from the active account, or null while locked; a lock cancels its plan. */
internal fun WalletStore.makeRevokeModel(allowance: AllowanceView): RevokeFlowModel? {
    val account = activeRecord ?: return null
    return RevokeFlowModel(
        walletCore,
        networkInfo,
        account,
        allowance,
        portfolio.preferences,
        RevokeLinks(portfolio.reads, rpc.transport) { plans += it },
    )
}

/** STRK base units last read for the active account, for the revoke's fee check; null when unread. */
val WalletStore.feeBalance: String?
    get() = portfolio.rawBalances(networkInfo)["STRK"]
