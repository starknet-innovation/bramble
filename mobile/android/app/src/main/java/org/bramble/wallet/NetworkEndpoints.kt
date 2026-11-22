package org.bramble.wallet

import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.WalletCore
import org.bramble.core.supportedNetworks

/**
 * [network]'s record as every RPC read and send uses it: the core's `networks()`, which puts the
 * wallet's custom RPC endpoint (Settings → Network → RPC endpoint) before the bundled ones, as the
 * extension's `networkRpcUrls`. Before a wallet exists the bundled record is used (onboarding has
 * no override to honour). With a wallet whose session is gone (the core's idle lock can land just
 * before the app's), the override is unreadable, so the record has no endpoints and every read
 * fails closed rather than sending the account to the bundled providers. Never log the result: an
 * override URL may carry an API key.
 */
fun endpointNetwork(
    network: NetworkId,
    wallet: WalletCore,
): NetworkInfo = endpointNetwork(network, wallet::networks, ::supportedNetworks)

/** [endpointNetwork] over its two sources, so the choice is testable without the native core. */
internal fun endpointNetwork(
    network: NetworkId,
    wallet: () -> List<NetworkInfo>,
    bundled: () -> List<NetworkInfo>,
): NetworkInfo {
    val records = runCatching(wallet)
    val info = (records.getOrNull() ?: bundled()).first { it.network == network }
    val failClosed = records.isFailure && records.exceptionOrNull() !is CoreException.NoWallet
    return if (failClosed) info.copy(rpcUrls = emptyList()) else info
}
