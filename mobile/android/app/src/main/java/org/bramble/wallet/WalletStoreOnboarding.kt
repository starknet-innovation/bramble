package org.bramble.wallet

// Onboarding on [WalletStore], split from WalletStore.kt by behaviour: a new or imported vault,
// then the way into the wallet. Main-thread only, like the store.

/**
 * Writes a new vault with a 12-word phrase on this network and keeps the words in
 * [WalletStore.pendingBackup] for the backup steps. Throws the core's error (or
 * [SessionEndedException]).
 */
suspend fun WalletStore.create(password: String) {
    val ticket = session.ticket()
    val network = network
    val words = calls.work(ticket) { walletCore.createWalletOnNetwork(password, 12u, network) }.words
    vaultWritten = true
    pendingBackup = words
}

/** Writes the vault with recovery pending and no accounts; "Find your accounts" comes next. */
suspend fun WalletStore.importWallet(
    phrase: String,
    password: String,
) {
    val ticket = session.ticket()
    calls.work(ticket) { walletCore.importWallet(password, phrase, null) }
    vaultWritten = true
}

/** Leaves onboarding (or "Find your accounts") for the wallet; the backup words are dropped here. */
suspend fun WalletStore.finishOnboarding() {
    pendingBackup = emptyList()
    enterWallet(session.ticket())
}
