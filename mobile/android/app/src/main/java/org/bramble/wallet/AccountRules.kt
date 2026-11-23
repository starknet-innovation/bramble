package org.bramble.wallet

import org.bramble.core.AccountRecord
import org.bramble.core.NetworkId
import org.bramble.core.UnusableAccount
import org.bramble.core.UnusableReason
import org.bramble.core.supportedNetworks

// Read-only rules over account records, split from WalletAccounts.kt: no core call, no state.

/** The display name of [record]'s network ("Starknet Mainnet"), for cross-network lists. */
fun networkName(record: AccountRecord): String = networkName(record.network)

/** The display name of [network] ("Starknet Mainnet"); empty for one the catalog lacks. */
fun networkName(network: NetworkId): String = supportedNetworks().firstOrNull { it.network == network }?.name ?: ""

/** The accounts the drawer, Send and Manage list: the core's hidden ones (`hiddenAccountIds`) left out. */
fun List<AccountRecord>.visible(): List<AccountRecord> = filterNot { it.hidden }

/** The hidden accounts, which Manage lists with the control that shows them again. */
fun List<AccountRecord>.hidden(): List<AccountRecord> = filter { it.hidden }

/** Why mobile keeps [account] without operating it, in one plain line (iOS `unusableReasonText`). */
fun unusableReasonText(account: UnusableAccount): String =
    when (account.reason) {
        UnusableReason.LEDGER -> "Ledger account. Ledger isn't on mobile yet."
        UnusableReason.IMPORTED_PHRASE -> "From another recovery phrase."
        UnusableReason.OTHER_NETWORK -> "On ${account.networkId}, which mobile doesn't support."
        UnusableReason.NOT_DERIVED_HERE -> "Mobile can't derive this account's key."
    }

/**
 * The extension's Home notice for a Ready account whose key an earlier Krusty derived
 * (`ready-key-notice.ts`, `portfolio.readyKey.*` on `release/v0.10.11`), twin of iOS `ReadyKeyNotice`.
 * Worded for the one action mobile has: it cannot reveal the key (docs/accounts.md §2.4a).
 */
object ReadyKeyNotice {
    /** The notice's heading. */
    const val TITLE = "Move this account's funds"

    /** What happens and what to do. */
    const val BODY =
        "Restoring your phrase won't find this account. Move its funds to another account."

    /** The control that opens Send for the account. */
    const val MOVE_FUNDS = "Move funds"

    /** Whether Home shows the notice: only for an account the core marks `preFixReadyKey`. */
    fun shows(account: AccountRecord?): Boolean = account?.preFixReadyKey == true
}
