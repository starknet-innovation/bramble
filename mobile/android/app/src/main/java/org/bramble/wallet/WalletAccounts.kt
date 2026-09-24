package org.bramble.wallet

import kotlinx.coroutines.CancellationException
import org.bramble.core.AccountFamily
import org.bramble.core.AccountRecord
import org.bramble.core.RecoverySelection
import org.bramble.core.supportedNetworks
import org.bramble.wallet.design.BrambleCopy

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

/** Commits the discovery picks in one vault write on this network; returns how many were restored. */
suspend fun WalletStore.restoreRecoveredAccounts(selections: List<RecoverySelection>): Int {
    val network = network
    return accountCall(reload = false) { it.restoreRecoveredAccounts(network, selections) }.size
}

/** Saves or clears (empty) an account's name, toasting as `bindAccountLabel` does. */
suspend fun WalletStore.saveLabel(accountId: String, label: String) =
    report("Label update failed") {
        val stored = accountCall { it.setAccountLabel(accountId, label) }
        showNotice(if (stored == null) "Label cleared" else "Label saved")
    }

/** Creates a group; true when it was created, so the form can clear. */
suspend fun WalletStore.createGroup(name: String, icon: String): Boolean =
    report("Group create failed") {
        accountCall { it.createAccountGroup(name, icon) }
        showNotice("Group created")
    }

suspend fun WalletStore.updateGroup(groupId: String, name: String, icon: String) =
    report("Group update failed") {
        accountCall { it.updateAccountGroup(groupId, name, icon) }
        showNotice("Group updated")
    }

suspend fun WalletStore.deleteGroup(groupId: String) =
    report("Group delete failed") {
        accountCall { it.deleteAccountGroup(groupId) }
        showNotice("Group deleted")
    }

/** Files an account into one folder, or none, as the drawer's folder picker does. */
suspend fun WalletStore.setGroup(accountId: String, groupId: String?) =
    report("Group update failed") {
        accountCall { it.setAccountGroup(accountId, groupId) }
        showNotice(if (groupId == null) "Removed from folder" else "Moved to folder")
    }

/** Toggles membership from a group's checklist (`bindGroupControls`). */
suspend fun WalletStore.toggleMember(accountId: String, groupId: String) {
    val member = groups.firstOrNull { it.id == groupId }?.accountIds?.contains(accountId) == true
    report("Group update failed") {
        accountCall { it.setAccountGroup(accountId, if (member) null else groupId) }
        showNotice(if (member) "Removed from group" else "Added to group")
    }
}

/** Runs [body]; any failure but a lock shows [failure] as a toast. True when it succeeded. */
private suspend fun WalletStore.report(failure: String, body: suspend () -> Unit): Boolean =
    try {
        body()
        true
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Exception) {
        showToast(failure)
        false
    }

/**
 * Why the Send flow must not open for [record], or null when it may. The core refuses to sign
 * for view-only (Braavos) records (`SendException.ViewOnlyAccount`) and for Ready/Argent ones
 * (`SendException.UnsupportedAccount`); the UI says so up front with the same copy.
 */
fun sendRefusal(record: AccountRecord): String? = when (record.family) {
    AccountFamily.OPEN_ZEPPELIN -> if (record.viewOnly) BrambleCopy.sendViewOnlyAccount else null
    AccountFamily.BRAAVOS -> BrambleCopy.sendViewOnlyAccount
    AccountFamily.ARGENT -> BrambleCopy.sendUnsupportedAccount
}

/** The display name of [record]'s network ("Starknet Mainnet"), for cross-network lists. */
fun networkName(record: AccountRecord): String =
    supportedNetworks().firstOrNull { it.network == record.network }?.name ?: ""
