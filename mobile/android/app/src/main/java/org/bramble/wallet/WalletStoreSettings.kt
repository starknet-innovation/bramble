package org.bramble.wallet

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
