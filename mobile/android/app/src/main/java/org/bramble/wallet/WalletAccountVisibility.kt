package org.bramble.wallet

import org.bramble.core.AccountRecord

// Hidden accounts over the core (docs/accounts.md §2.4a), split from WalletAccounts.kt;
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
    accountCall { it.setAccountHidden(accountId, hidden) }
    showNotice(if (hidden) "Account hidden" else "Account shown")
}
