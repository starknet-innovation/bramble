package org.bramble.wallet

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
): String? {
    val ticket = session.ticket()
    val saved = calls.work(ticket) { walletCore.setRpcOverride(target, raw) }
    // The portfolio's scope holds the endpoint list it was entered with: a change to the network
    // on screen enters it again, so no read goes to the old endpoints after the save.
    if (target == network) {
        portfolio.lock()
        // The app's scope: leaving the Network screen must not cancel the reload after the lock.
        appScope.launch { refreshBalances(ticket) }
    }
    return saved
}
