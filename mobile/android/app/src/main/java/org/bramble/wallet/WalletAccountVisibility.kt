package org.bramble.wallet

import kotlinx.coroutines.CancellationException
import org.bramble.core.AccountRecord
import org.bramble.core.UnusableAccount

// Hidden and kept accounts over the core (docs/accounts.md §2.4a), split from WalletAccounts.kt;
// twin of the visibility half of iOS WalletStore+Accounts.swift. The core owns every rule.

/** This network's accounts the drawer, Send and Manage list (hidden ones left out). */
val WalletStore.visibleRecords: List<AccountRecord> get() = records.visible()

/** This network's hidden accounts, for Manage's "Hidden accounts". */
val WalletStore.hiddenRecords: List<AccountRecord> get() = records.hidden()

/**
 * Hides or shows one account (`writeAccountVisibility`). The core refuses hiding the last account
 * a network shows and moves the active account off one it hides; callers show that refusal with
 * [WalletStore.showError], as the extension shows the background's.
 */
suspend fun WalletStore.setHidden(
    accountId: String,
    hidden: Boolean,
) {
    runCatching { accountCall { it.setAccountHidden(accountId, hidden) } }.onFailure { refused ->
        // Hiding the active account is two writes: the core may have moved the active account
        // before the hide failed. Re-read, so the app follows the core's active account.
        if (refused !is CancellationException) runCatching { accountCall { } }
        throw refused
    }
    showNotice(if (hidden) "Account hidden" else "Account shown")
}

/**
 * The accounts the vault holds that mobile keeps but does not operate, for Manage's read-only
 * section; empty when the read fails (the list only explains, it never gates anything).
 */
suspend fun WalletStore.unusableAccounts(): List<UnusableAccount> =
    try {
        accountCall(reload = false) { it.unusableAccounts() }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (ignored: Exception) {
        emptyList()
    }
