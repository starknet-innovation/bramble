package org.bramble.wallet

import org.bramble.core.AccountRecord
import org.bramble.core.UnusableAccount
import org.bramble.core.UnusableReason
import org.bramble.core.supportedNetworks

// Read-only rules over account records, split from WalletAccounts.kt: no core call, no state.

/** The display name of [record]'s network ("Starknet Mainnet"), for cross-network lists. */
fun networkName(record: AccountRecord): String =
    supportedNetworks().firstOrNull { it.network == record.network }?.name ?: ""

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
