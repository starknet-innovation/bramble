package org.bramble.wallet

import org.bramble.core.LedgerAccountRequest

// Ledger accounts into the vault (P8) on [WalletStore], twin of iOS WalletStore+Ledger.swift: a
// Ledger-only wallet at onboarding, or more Ledger accounts beside the wallet's own. The core
// places every address from the request the picker read; this layer orders the calls.

/**
 * Creates a wallet with no recovery phrase from the first of [requests], sealed under
 * [password], then adds the rest; the first stays active. Throws the core's refusal (or
 * [SessionEndedException]); a failure after the wallet exists leaves the accounts added so far.
 */
suspend fun WalletStore.createLedgerWallet(
    password: String,
    requests: List<LedgerAccountRequest>,
) {
    val first = requests.firstOrNull() ?: return
    val ticket = session.ticket()
    calls.work(ticket) {
        val record = walletCore.createLedgerWallet(password, first)
        requests.drop(1).forEach { walletCore.addLedgerAccount(it) }
        if (requests.size > 1) walletCore.selectAccount(record.id)
    }
    vaultWritten = true
}

/** Adds the picked Ledger accounts to the unlocked wallet; each add makes its account active. */
suspend fun WalletStore.addLedgerAccounts(requests: List<LedgerAccountRequest>) {
    accountCall { core -> requests.forEach { core.addLedgerAccount(it) } }
    showNotice(if (requests.size == 1) "Account added" else "${requests.size} accounts added")
}

/**
 * Whether the unlocked wallet has a recovery phrase; a Ledger-only wallet has none and hides what
 * needs one. True when the core cannot say, so a failed read hides nothing.
 */
val WalletStore.hasRecoveryPhrase: Boolean
    get() = runCatching { walletCore.hasRecoveryPhrase() }.getOrDefault(true)

/** Addresses on the selected network, so the picker shows which accounts are already here. */
val WalletStore.heldAddresses: Set<String>
    get() = records.map { it.address }.toSet()
