package org.bramble.wallet

import org.bramble.core.AccountRecord
import org.bramble.core.NetworkId
import org.bramble.core.supportedNetworks

// Read-only rules over one account record, split from WalletAccounts.kt: no core call, no state.

/** The display name of [record]'s network ("Starknet Mainnet"), for cross-network lists. */
fun networkName(record: AccountRecord): String = networkName(record.network)

/** The display name of [network] ("Starknet Mainnet"); empty for one the catalog lacks. */
fun networkName(network: NetworkId): String = supportedNetworks().firstOrNull { it.network == network }?.name ?: ""
