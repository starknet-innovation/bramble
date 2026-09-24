package org.bramble.wallet

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.TokenInfo
import org.bramble.core.formatTokenAmount

/** The network and address a balance read belongs to. */
typealias BalanceView = Pair<NetworkId, String>

/**
 * Public token balances for one view (network and account address), split out of [WalletStore].
 * A read is tied to the view it was sent for: a result that returns after a lock, a network switch,
 * or an account change ([refresh]'s `current` turns false) is dropped, never shown under the new
 * view. A failed read only marks the network unhealthy. Main-thread only, like the store.
 */
class Balances(private val rpc: RpcClient = RpcClient()) {
    private var raw by mutableStateOf(emptyMap<String, String>())
    /** The view [raw] was read for; nothing is shown for any other view. */
    private var owner by mutableStateOf<BalanceView?>(null)
    var networkHealthy by mutableStateOf(true)
        private set

    fun clear() {
        raw = emptyMap()
        owner = null
    }

    /** Base-unit balances by symbol for [view], or empty until they have loaded for it. */
    fun of(view: BalanceView?): Map<String, String> = if (owner != null && owner == view) raw else emptyMap()

    suspend fun refresh(view: BalanceView, network: NetworkInfo, current: () -> Boolean) {
        val result = runCatching { rpc.balances(view.second, network) }
        if (!current()) return
        result.onSuccess {
            raw = it
            owner = view
            networkHealthy = true
        }.onFailure { networkHealthy = false }
    }

    /** Balance formatted for display, or null until it has loaded for [view]. */
    fun amount(token: TokenInfo, view: BalanceView?): String? {
        val value = of(view)[token.symbol] ?: return null
        return runCatching { formatTokenAmount(value, token.decimals, 4u) }.getOrNull()
    }
}
