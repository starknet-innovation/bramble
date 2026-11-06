package org.bramble.wallet

import org.bramble.core.AccountRecord
import org.bramble.core.supportedNetworks

// Read-only rules over one account record, split from WalletAccounts.kt: no core call, no state.

/** The display name of [record]'s network ("Starknet Mainnet"), for cross-network lists. */
fun networkName(record: AccountRecord): String =
    supportedNetworks().firstOrNull { it.network == record.network }?.name ?: ""
