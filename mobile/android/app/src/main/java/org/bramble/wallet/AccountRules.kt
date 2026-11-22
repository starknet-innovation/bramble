package org.bramble.wallet

import org.bramble.core.AccountRecord
import org.bramble.core.supportedNetworks

// Read-only rules over account records, split from WalletAccounts.kt: no core call, no state.

/** The display name of [record]'s network ("Starknet Mainnet"), for cross-network lists. */
fun networkName(record: AccountRecord): String =
    supportedNetworks().firstOrNull { it.network == record.network }?.name ?: ""

/** The accounts the drawer, Send and Manage list: the core's hidden ones (`hiddenAccountIds`) left out. */
fun List<AccountRecord>.visible(): List<AccountRecord> = filterNot { it.hidden }

/** The hidden accounts, which Manage lists with the control that shows them again. */
fun List<AccountRecord>.hidden(): List<AccountRecord> = filter { it.hidden }
