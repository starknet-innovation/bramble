package org.bramble.wallet

import org.bramble.core.AccountFamily
import org.bramble.core.AccountRecord
import org.bramble.core.supportedNetworks
import org.bramble.wallet.design.BrambleCopy

// Read-only rules over one account record, split from WalletAccounts.kt: no core call, no state.

/**
 * Why the Send flow must not open for [record], or null when it may. The core refuses to sign
 * for view-only (Braavos) records (`SendException.ViewOnlyAccount`) and for Ready/Argent ones
 * (`SendException.UnsupportedAccount`); the UI says so up front with the same copy.
 */
fun sendRefusal(record: AccountRecord): String? =
    when (record.family) {
        AccountFamily.OPEN_ZEPPELIN -> if (record.viewOnly) BrambleCopy.sendViewOnlyAccount else null
        AccountFamily.BRAAVOS -> BrambleCopy.sendViewOnlyAccount
        AccountFamily.ARGENT -> BrambleCopy.sendUnsupportedAccount
    }

/** The display name of [record]'s network ("Starknet Mainnet"), for cross-network lists. */
fun networkName(record: AccountRecord): String =
    supportedNetworks().firstOrNull { it.network == record.network }?.name ?: ""
