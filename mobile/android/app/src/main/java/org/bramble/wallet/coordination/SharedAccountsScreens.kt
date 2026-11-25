package org.bramble.wallet.coordination

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import org.bramble.core.MultisigRecord
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.OptionCard
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.ui.shortAddress

// The shared-account (multisig) screens, port of iOS `SharedAccountsView.swift` and
// `CoordinationNavigation.swift`: the Ready Multisig gateway, the list, and adding by address.
// The create flow is `CreateMultisigScreen.kt`, an account's home `SharedAccountHome.kt`.

private const val ADD_SHARED = "Add shared account"

private const val ADD_SHARED_HINT =
    "If deployed, signer authority syncs from Starknet. If not, the address is saved and deployment " +
        "setup is verified before use."

/** `multisigDisplayName`: the saved name, else the shortened address. */
internal fun multisigDisplayName(record: MultisigRecord): String = record.name ?: shortAddress(record.address)

/** The stored-view label: threshold and signer count, or unavailable when authority is unknown. */
internal fun multisigConfigLabel(record: MultisigRecord): String =
    record.threshold?.let { "$it of ${record.signerCount} signers" } ?: "Authority unavailable"

/** The multisig screens a shared-accounts entry point pushes (iOS `CoordinationFlow`). */
internal sealed interface MultisigFlow {
    /** Add a shared account by address. */
    data object AddShared : MultisigFlow

    /** Create a multisig; [resume] names a saved, undeployed setup to complete. */
    data class Create(
        val resume: String?,
    ) : MultisigFlow

    /** One shared account's home. */
    data class Account(
        val id: String,
    ) : MultisigFlow

    /** One shared account's receive address. */
    data class Receive(
        val id: String,
    ) : MultisigFlow

    /** A transfer from the multisig (M18). */
    data class Propose(
        val id: String,
    ) : MultisigFlow

    /** The multisig's signers and a signer change. */
    data class Signers(
        val id: String,
    ) : MultisigFlow

    /** Import a co-signer's package. */
    data class Import(
        val id: String,
    ) : MultisigFlow

    /** One stored signing intent. */
    data class Intent(
        val multisigId: String,
        val intentId: String,
    ) : MultisigFlow
}

/**
 * Hosts [root] and the multisig screens it opens on their own stack, so the shell keeps one flow
 * per entry point. The system back gesture pops this stack before the shell's.
 */
@Composable
private fun MultisigStack(
    store: WalletStore,
    root: @Composable (open: (MultisigFlow) -> Unit) -> Unit,
) {
    var stack by remember { mutableStateOf(listOf<MultisigFlow>()) }
    val open = { next: MultisigFlow -> stack = stack + next }
    val pop = { stack = stack.dropLast(1) }
    BackHandler(enabled = stack.isNotEmpty()) { pop() }
    when (val top = stack.lastOrNull()) {
        null -> root(open)
        MultisigFlow.AddShared -> AddSharedAccountScreen(store, back = pop)
        is MultisigFlow.Create -> CreateMultisigScreen(store, top.resume, back = pop)
        is MultisigFlow.Account -> SharedAccountHomeScreen(store, top.id, open, back = pop)
        is MultisigFlow.Receive -> SharedReceiveScreen(store, top.id, back = pop)
        is MultisigFlow.Propose -> MultisigProposeScreen(store, top.id, back = pop)
        is MultisigFlow.Signers -> MultisigSignersScreen(store, top.id, back = pop)
        is MultisigFlow.Import -> MultisigImportScreen(store, top.id, back = pop)
        is MultisigFlow.Intent -> MultisigIntentScreen(store, top.multisigId, top.intentId, back = pop)
    }
}

/** `multisig-add`: the Ready Multisig gateway, reached from "Add account". */
@Composable
fun ReadyMultisigScreen(
    store: WalletStore,
    back: () -> Unit,
) = MultisigStack(store) { open ->
    Page(store, "Ready Multisig", "Multiple signers approve together", back) {
        OptionCard(BrambleIconName.USERS, "Create a multisig", "Set participants, fund, and deploy.") {
            open(MultisigFlow.Create(null))
        }
        OptionCard(BrambleIconName.SEARCH, "Add a shared address", "Sync it or resume setup.") {
            open(MultisigFlow.AddShared)
        }
    }
}

/** `multisigs`: the two setup actions and every shared account saved on the active network. */
@Composable
fun SharedAccountsScreen(
    store: WalletStore,
    back: () -> Unit,
) = MultisigStack(store) { open ->
    val coordination = store.coordination
    LaunchedEffect(Unit) { coordination.refresh() }
    val records = coordination.multisigs
    Page(store, "Shared accounts", "${records.size} account${if (records.size == 1) "" else "s"}", back) {
        MenuGroup {
            MenuRow(BrambleIconName.PLUS, ADD_SHARED) { open(MultisigFlow.AddShared) }
            MenuDivider()
            MenuRow(BrambleIconName.USERS, "Create a multisig") { open(MultisigFlow.Create(null)) }
        }
        Eyebrow("Shared accounts")
        if (records.isEmpty()) {
            Caption("No shared accounts are saved on this network yet.")
        } else {
            MenuGroup {
                records.forEachIndexed { index, record ->
                    if (index > 0) MenuDivider()
                    val pending = coordination.openIntents[record.id]?.takeIf { it > 0 }?.let { " · $it open" } ?: ""
                    MenuRow(
                        BrambleIconName.WALLET,
                        multisigDisplayName(record),
                        value =
                            multisigConfigLabel(record) + pending,
                    ) {
                        open(MultisigFlow.Account(record.id))
                    }
                }
            }
        }
    }
}

/**
 * `multisig-watch`: add a shared account by address. A deployed account's authority is read at
 * one pinned block; an undeployed one is saved by address alone.
 */
@Composable
private fun AddSharedAccountScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    Page(store, ADD_SHARED, "Sync or resume a Ready multisig", back) {
        BrambleField(
            "Multisig address",
            "0x…",
            address,
            { address = it },
            kind = SecretKind.ADDRESS,
            hint = ADD_SHARED_HINT,
        )
        PillButton(ADD_SHARED, busy = busy, enabled = address.isNotBlank()) {
            scope.launch {
                busy = true
                runCatching { store.coordination.addShared(address) }
                    .onSuccess {
                        store.showNotice(it)
                        result = null
                    }.onFailure {
                        val message = (it as? CoordinationStore.Refusal)?.message ?: describe(it)
                        result = message
                        store.showToast(message)
                    }
                busy = false
            }
        }
        StatusLine(result, StatusTone.DANGER)
    }
}
