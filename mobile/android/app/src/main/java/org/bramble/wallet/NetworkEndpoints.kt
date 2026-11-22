package org.bramble.wallet

import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.WalletCore
import org.bramble.core.supportedNetworks

/**
 * [network]'s record as every RPC read and send uses it: the core's `networks()`, which puts the
 * wallet's custom RPC endpoint (Settings → Network → RPC endpoint) before the bundled ones, as the
 * extension's `networkRpcUrls`. Before a wallet exists, or while it is locked, the core holds no
 * readable override and refuses `networks()`; the bundled record is used then (onboarding has no
 * override to honour, and no account read runs while locked). Never log the result: an override
 * URL may carry an API key.
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
): NetworkInfo = (runCatching(wallet).getOrNull() ?: bundled()).first { it.network == network }
