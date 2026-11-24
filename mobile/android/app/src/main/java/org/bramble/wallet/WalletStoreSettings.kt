package org.bramble.wallet

import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import org.bramble.core.NetworkId
import org.bramble.wallet.design.ThemeChoice

// The non-secret preferences of [WalletStore] (network and appearance), split from WalletStore.kt
// by behaviour. Main-thread only, like the store.

/** Switches to [next], remembers it, and re-enters the wallet on it (accounts, balances). */
suspend fun WalletStore.switchNetwork(next: NetworkId) {
    privacy.reset()
    network = next
    portfolio.lock()
    prefs.edit().putString(NetworkPreference.KEY, NetworkPreference.stored(next)).apply()
    enterWallet(session.ticket())
}

/** Applies and remembers the appearance [choice]. */
fun WalletStore.setTheme(choice: ThemeChoice) {
    theme = choice
    prefs.edit().putString(ThemeChoice.STORAGE_KEY, choice.stored).apply()
}

/** The selected network's RPC override, for the settings field; "" for the defaults or while locked. */
fun WalletStore.rpcOverride(): String = runCatching { walletCore.rpcOverride(network) }.getOrNull().orEmpty()

/**
 * `setRpcOverride` for [target]: the core trims [raw], clears the override when it is empty, and
 * refuses anything but a plain `https` URL (thrown as its `InvalidInput`). Returns what is stored.
 */
suspend fun WalletStore.saveRpcOverride(
    target: NetworkId,
    raw: String,
): String? =
    // The app's scope, for the write and what follows it: leaving the Network screen cancels the
    // caller, and a cancel after the core stored the override must not skip the reload.
    appScope
        .async {
            val ticket = session.ticket()
            val saved = calls.work(ticket) { walletCore.setRpcOverride(target, raw) }
            // The portfolio's scope holds the endpoint list it was entered with: a change to the
            // network on screen enters it again, so no read goes to the old endpoints after the save.
            if (target == network) {
                portfolio.lock()
                appScope.launch { refreshBalances(ticket) }
            }
            saved
        }.await()

/** Product analytics on or off (`GatewayAnalytics`); the next gateway request follows it. */
fun WalletStore.setProductAnalytics(on: Boolean) {
    GatewayAnalytics.shared?.enabled = on
    showNotice(if (on) "Product analytics enabled" else "Product analytics disabled")
}

/** Reliability diagnostics on or off, remembered; off clears the counters at once. */
fun WalletStore.setReliabilityDiagnostics(on: Boolean) {
    ReliabilityDiagnostics.enabled = on
    prefs.edit().putBoolean(ReliabilityDiagnostics.ENABLED_KEY, on).apply()
    showNotice(if (on) "Local diagnostics enabled" else "Local diagnostics cleared")
}
