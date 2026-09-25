package org.bramble.wallet

import kotlinx.coroutines.CancellationException
import org.bramble.core.AccountRecord

// Account management over the core (docs/accounts.md §2–3.3), twin of iOS WalletStore+Accounts.swift.
// The core owns every rule; these only run one call through the store's session
// ([WalletStore.accountCall]), refresh what is rendered, and report in the extension's words.
// Uncompiled: checked by reading against the generated Kotlin bindings (no Android SDK here).

/** "Regular account": OpenZeppelin at the next free index on this network, made active. */
suspend fun WalletStore.addRegularAccount() {
    val network = network
    accountCall { it.addRegularAccount(network) }
    showNotice("Account added")
}

/** Makes [accountId] the vault's one active account. */
suspend fun WalletStore.select(accountId: String) {
    if (accountId == activeRecord?.id) return
    accountCall { it.selectAccount(accountId) }
}

/** The new vault's primary account (OpenZeppelin index 0 on this network), for the review step. */
suspend fun WalletStore.previewAccount(): AccountRecord? = accountCall(reload = false) { it.activeAccount() }

/** Saves or clears (empty) an account's name, toasting as `bindAccountLabel` does. */
suspend fun WalletStore.saveLabel(
    accountId: String,
    label: String,
) = report("Label update failed") {
    val stored = accountCall { it.setAccountLabel(accountId, label) }
    showNotice(if (stored == null) "Label cleared" else "Label saved")
}

/** Creates a group; true when it was created, so the form can clear. */
suspend fun WalletStore.createGroup(
    name: String,
    icon: String,
): Boolean =
    report("Group create failed") {
        accountCall { it.createAccountGroup(name, icon) }
        showNotice("Group created")
    }

/** Saves a group's name and icon, toasting as the extension does. */
suspend fun WalletStore.updateGroup(
    groupId: String,
    name: String,
    icon: String,
) = report(GROUP_UPDATE_FAILED) {
    accountCall { it.updateAccountGroup(groupId, name, icon) }
    showNotice("Group updated")
}

/** Deletes a group, toasting as the extension does. */
suspend fun WalletStore.deleteGroup(groupId: String) =
    report("Group delete failed") {
        accountCall { it.deleteAccountGroup(groupId) }
        showNotice("Group deleted")
    }

/** Files an account into one folder, or none, as the drawer's folder picker does. */
suspend fun WalletStore.setGroup(
    accountId: String,
    groupId: String?,
) = report(GROUP_UPDATE_FAILED) {
    accountCall { it.setAccountGroup(accountId, groupId) }
    showNotice(if (groupId == null) "Removed from folder" else "Moved to folder")
}

/** Toggles membership from a group's checklist (`bindGroupControls`). */
suspend fun WalletStore.toggleMember(
    accountId: String,
    groupId: String,
) {
    val member = groups.firstOrNull { it.id == groupId }?.accountIds?.contains(accountId) == true
    report(GROUP_UPDATE_FAILED) {
        accountCall { it.setAccountGroup(accountId, if (member) null else groupId) }
        showNotice(if (member) "Removed from group" else "Added to group")
    }
}

/** Runs [body]; any failure but a lock shows [failure] as a toast. True when it succeeded. */
private suspend fun WalletStore.report(
    failure: String,
    body: suspend () -> Unit,
): Boolean =
    try {
        body()
        true
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Exception) {
        showToast(failure)
        false
    }

/** The toast for any failed group edit or membership change. */
private const val GROUP_UPDATE_FAILED = "Group update failed"
