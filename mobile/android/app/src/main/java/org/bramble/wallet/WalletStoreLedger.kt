package org.bramble.wallet

import org.bramble.core.LedgerAccountRequest

// Ledger accounts into the vault (P8) on [WalletStore], twin of iOS WalletStore+Ledger.swift: a
// Ledger-only wallet at onboarding, or more Ledger accounts beside the wallet's own. The core
// places every address from the request the picker read; this layer orders the calls.

/**
 * Creates a wallet with no recovery phrase from the first of [requests], sealed under
 * [password], then adds the rest; the first stays active. Throws [IllegalArgumentException] for
 * no picks, and the core's refusal (or [SessionEndedException]) when the wallet was not created.
 * Once it exists the wallet counts as created: a later pick that fails to add is shown as an
 * error toast, never thrown, so onboarding moves on and a retry never meets "a wallet exists".
 */
suspend fun WalletStore.createLedgerWallet(
    password: String,
    requests: List<LedgerAccountRequest>,
) {
    val first = requests.firstOrNull() ?: throw IllegalArgumentException("no Ledger account picked")
    val ticket = session.ticket()
    var created = false
    val failed =
        try {
            calls.work(ticket) {
                val record = walletCore.createLedgerWallet(password, first)
                created = true
                val failed = requests.drop(1).count { runCatching { walletCore.addLedgerAccount(it) }.isFailure }
                if (requests.size > 1) runCatching { walletCore.selectAccount(record.id) }
                failed
            }
        } finally {
            if (created) vaultWritten = true
        }
    if (failed > 0) showToast(ledgerNotAdded(failed))
}

/** The toast after onboarding for [count] picks the core refused to add. */
fun ledgerNotAdded(count: Int): String =
    if (count ==
        1
    ) {
        "1 account wasn't added. Add it from Add account."
    } else {
        "$count accounts weren't added. Add them from Add account."
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
