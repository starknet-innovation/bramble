package org.bramble.wallet

import org.bramble.core.AccountFamily
import org.bramble.core.AccountRecord
import org.bramble.core.supportedNetworks
import org.bramble.wallet.design.BrambleCopy

// Read-only rules over one account record, split from WalletAccounts.kt: no core call, no state.

/**
 * Why the Send flow must not open for [record], or null when it may. The core signs for
 * OpenZeppelin and Ready (Argent) records and refuses view-only (Braavos) ones
 * (`SendException.ViewOnlyAccount`); the UI says so up front with the same copy.
 */
fun sendRefusal(record: AccountRecord): String? =
    if (record.viewOnly || record.family == AccountFamily.BRAAVOS) BrambleCopy.sendViewOnlyAccount else null

/** The display name of [record]'s network ("Starknet Mainnet"), for cross-network lists. */
fun networkName(record: AccountRecord): String =
    supportedNetworks().firstOrNull { it.network == record.network }?.name ?: ""
