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

/**
 * Records that Confirm backup succeeded, so no later unlock returns to Save phrase. Throws the
 * core's error; the flag then stays set and the step is offered again.
 */
suspend fun WalletStore.confirmBackup() {
    val ticket = session.ticket()
    calls.work(ticket) { walletCore.confirmBackup() }
}

/**
 * Reveals the words of a wallet whose backup is still pending, for Save phrase, after the
 * passphrase check the core applies to every reveal (throttled and counted).
 */
suspend fun WalletStore.revealPendingBackup(password: String) {
    pendingBackup = revealPhrase(password)
}

/** Leaves onboarding (or "Find your accounts") for the wallet; the backup words are dropped here. */
suspend fun WalletStore.finishOnboarding() {
    pendingBackup = emptyList()
    enterWallet(session.ticket())
}
