package org.bramble.wallet

import org.bramble.core.AccountRecord
import org.bramble.core.supportedNetworks

// Account management over the core (docs/accounts.md §3.3), twin of iOS WalletStore+Accounts.swift.
// The core owns every rule; these only refresh what is rendered and report in the extension's
// words. UNCOMPILED: written against the generated Kotlin bindings (no Android SDK on the
// authoring machine).

/** Saves or clears (empty) an account's name, toasting as `bindAccountLabel` does. */
suspend fun WalletStore.saveLabel(label: String, id: String) {
    runCatching { work { walletCore.setAccountLabel(id, label) } }
        .onSuccess { stored ->
            reloadAccounts()
            toast = (if (stored == null) "Label cleared" else "Label saved") to true
        }
        .onFailure { toast = "Label update failed" to false }
}

suspend fun WalletStore.createGroup(name: String, icon: String): Boolean =
    runCatching { work { walletCore.createAccountGroup(name, icon) } }
        .onSuccess { reloadAccounts(); toast = "Group created" to true }
        .onFailure { toast = "Group create failed" to false }
        .isSuccess

suspend fun WalletStore.updateGroup(id: String, name: String, icon: String) {
    runCatching { work { walletCore.updateAccountGroup(id, name, icon) } }
        .onSuccess { reloadAccounts(); toast = "Group updated" to true }
        .onFailure { toast = "Group update failed" to false }
}

suspend fun WalletStore.deleteGroup(id: String) {
    runCatching { work { walletCore.deleteAccountGroup(id) } }
        .onSuccess { reloadAccounts(); toast = "Group deleted" to true }
        .onFailure { toast = "Group delete failed" to false }
}

/** Files an account into one folder, or none, as the drawer picker does. */
suspend fun WalletStore.setGroup(groupId: String?, accountId: String) {
    runCatching { work { walletCore.setAccountGroup(accountId, groupId) } }
        .onSuccess { reloadAccounts(); toast = (if (groupId == null) "Removed from folder" else "Moved to folder") to true }
        .onFailure { toast = "Group update failed" to false }
}

/** Toggles membership from a group's checklist (`bindGroupControls`). */
suspend fun WalletStore.toggleMember(accountId: String, groupId: String) {
    val member = groups.firstOrNull { it.id == groupId }?.accountIds?.contains(accountId) == true
    runCatching { work { walletCore.setAccountGroup(accountId, if (member) null else groupId) } }
        .onSuccess { reloadAccounts(); toast = (if (member) "Removed from group" else "Added to group") to true }
        .onFailure { toast = "Group update failed" to false }
}

fun networkName(record: AccountRecord): String =
    supportedNetworks().firstOrNull { it.network == record.network }?.name ?: ""
