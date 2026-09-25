package org.bramble.wallet.coordination

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.bramble.core.CoordinationSyncOutcome
import org.bramble.core.CoreException
import org.bramble.core.MultisigRecord
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.OptionCard
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.ui.shortAddress

// The shared-account (multisig) screens: the Ready Multisig gateway, the list with add and sync,
// and the create section (`CreateMultisigSection.kt`). Same conventions as `CoordinationScreens.kt`.

private const val ADD_SHARED_HINT =
    "If deployed, signer authority syncs from Starknet. If not, the address is saved and deployment " +
        "setup is verified before use."

private const val SYNC_UNAVAILABLE = "Secure co-signer updates are unavailable. Try again shortly"

private const val SYNC_UNVERIFIED = "Secure co-signer updates could not be verified. Try again shortly"

private fun configLabel(record: MultisigRecord): String =
    record.threshold?.let { "$it of ${record.signerCount} signers" } ?: "Authority unavailable"

/** `multisig-add`: the Ready Multisig gateway, reached from "Add account". */
@Composable
fun ReadyMultisigScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    var shared by remember { mutableStateOf(false) }
    if (shared) return SharedAccountsScreen(store) { shared = false }
    Page(store, "Ready Multisig", "Multiple signers approve together", back) {
        OptionCard(BrambleIconName.USERS, "Create a multisig", "Set participants, fund, and deploy.") { shared = true }
        OptionCard(BrambleIconName.SEARCH, "Add a shared address", "Sync it or resume setup.") { shared = true }
    }
}

/** `multisigs`: add by address, create a setup, and each saved shared account with its updates. */
@Composable
fun SharedAccountsScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var addError by remember { mutableStateOf<String?>(null) }
    var syncResult by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var open by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { coordination.refresh() }
    val records = coordination.multisigs
    Page(store, "Shared accounts", "${records.size} account${if (records.size == 1) "" else "s"}", back) {
        BrambleField(
            "Multisig address",
            "0x…",
            address,
            { address = it },
            kind = SecretKind.ADDRESS,
            hint = ADD_SHARED_HINT,
        )
        PillButton("Add shared account", enabled = address.isNotBlank()) {
            scope.launch {
                runCatching { coordination.addShared(address) }
                    .onSuccess {
                        store.showNotice(it)
                        addError = null
                        address = ""
                    }.onFailure { addError = it.message ?: describe(it) }
            }
        }
        StatusLine(addError, StatusTone.DANGER)
        CreateMultisigSection(store)
        Eyebrow("Shared accounts")
        if (records.isEmpty()) Caption("No shared accounts are saved on this network yet.")
        records.forEach { record ->
            Disclosure(
                record.name ?: shortAddress(record.address),
                open = open == record.id,
                onToggle = { open = if (open == record.id) null else record.id },
                detail = configLabel(record),
            ) {
                SharedAccountBody(store, record, scope, syncResult[record.id]) { message ->
                    syncResult = syncResult + (record.id to message)
                }
            }
        }
    }
}

/** One shared account's disclosure body: check for co-signer updates, and stop watching. */
@Composable
private fun SharedAccountBody(
    store: WalletStore,
    record: MultisigRecord,
    scope: CoroutineScope,
    status: String?,
    synced: (String) -> Unit,
) {
    val coordination = store.coordination
    RowTitle("Co-signer updates")
    Caption("Check securely for intents and signatures shared by known contacts.")
    PillButton("Check for updates", kind = PillKind.SECONDARY, icon = BrambleIconName.REFRESH) {
        scope.launch {
            val message = syncMessage(runCatching { coordination.sync(record.id) })
            synced(message)
        }
    }
    StatusLine(status)
    Caption("Removing stops local tracking only. It never changes the on-chain account.")
    PillButton("Stop watching", kind = PillKind.GHOST) {
        scope.launch { runCatching { coordination.removeShared(record.id) }.onFailure(store::showError) }
    }
}

/** The status copy for one "Check for updates". */
private fun syncMessage(outcome: Result<CoordinationSyncOutcome>): String =
    outcome.fold(
        {
            if (it.held == 0u) {
                "No new co-signer updates"
            } else {
                "${it.held} co-signer update${if (it.held == 1u) "" else "s"} received. " +
                    "Open them after the next Bramble update."
            }
        },
        { if (it is CoreException.Coordination) SYNC_UNAVAILABLE else SYNC_UNVERIFIED },
    )
