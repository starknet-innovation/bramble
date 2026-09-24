package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.launch
import org.bramble.core.AccountGroup
import org.bramble.core.accountLabel
import org.bramble.core.groupIcons
import org.bramble.wallet.WalletStore
import org.bramble.wallet.addRegularAccount
import org.bramble.wallet.createGroup
import org.bramble.wallet.deleteGroup
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.CheckRow
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FilterChip
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.OptionCard
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.networkName
import org.bramble.wallet.saveLabel
import org.bramble.wallet.select
import org.bramble.wallet.toggleMember
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.updateGroup

/** A label or group name, as the core's `is_account_label` bounds it (1–64 characters, trimmed). */
private const val NAME_LIMIT = 64

/**
 * "Accounts & groups" (`accountFlow`, `docs/accounts.md` §2.4), port of the iOS
 * `AccountsManageView`: the active account's name form and receipt (address, signer public key,
 * class hash, each copied in full), this network's accounts with an inline copy, and the groups
 * (create, rename, change icon, membership, delete). Every rule is the core's; fields are the flat
 * design-system field. "Add account" opens the same chooser as the drawer.
 */
@Composable
fun ManageAccountsScreen(store: WalletStore, back: () -> Unit) {
    var choosing by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        if (choosing) {
            AddAccountChooser(store, close = { choosing = false }, added = { choosing = false })
        } else {
            FlowHeader("Accounts & groups", network = store.networkLabel, back = back)
            ActiveAccountSection(store)
            Eyebrow("Accounts")
            AccountList(store)
            PillButton("Add account", kind = PillKind.SECONDARY, icon = BrambleIconName.PLUS) { choosing = true }
            Eyebrow("Groups")
            NewGroupForm(store)
            store.groups.forEach { group -> GroupEditor(store, group) }
        }
    }
}

/** This network's accounts; tapping one makes it active, and each row copies its address inline. */
@Composable
private fun AccountList(store: WalletStore) {
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        store.records.forEach { record ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                AccountRow(record, record.id == store.activeRecord?.id, Modifier.weight(1f)) {
                    scope.launch { runCatching { store.select(record.id) }.onFailure(store::showError) }
                }
                CopyButton(store, record.address, "Copy ${record.displayName} address")
            }
        }
    }
}

/** `#label-form` and the active account's receipt. */
@Composable
private fun ActiveAccountSection(store: WalletStore) {
    val scope = rememberCoroutineScope()
    val active = store.activeRecord ?: return
    var label by remember(active.id) { mutableStateOf(active.label ?: "") }
    Eyebrow("Active account")
    BrambleField(
        label = "Name",
        placeholder = active.shortAddress,
        value = label,
        onValueChange = { if (it.length <= NAME_LIMIT) label = it },
        kind = SecretKind.ADDRESS,
        hint = "Shown instead of the address. Leave empty to clear.",
    )
    PillButton("Save name", kind = PillKind.SECONDARY, busy = store.busy) { scope.launch { store.saveLabel(active.id, label) } }
    MenuGroup {
        ReceiptRow("Address", active.shortAddress) { CopyButton(store, active.address, "Copy address") }
        MenuDivider()
        ReceiptRow("Signer public key", accountLabel(active.publicKey)) { CopyButton(store, active.publicKey, "Copy signer public key") }
        MenuDivider()
        ReceiptRow("Class hash", accountLabel(active.classHash)) { CopyButton(store, active.classHash, "Copy class hash") }
        active.typeLabel?.let { type ->
            MenuDivider()
            ReceiptRow("Type", type, mono = false)
        }
    }
}

/** One receipt line: label, truncated value, and an optional trailing copy control. */
@Composable
internal fun ReceiptRow(label: String, value: String, mono: Boolean = true, trailing: (@Composable () -> Unit)? = null) {
    val skin = LocalSkin.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = BrambleLayout.menuRowMin).padding(start = BrambleSpace.lg, end = BrambleSpace.xs),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.label), modifier = Modifier.weight(1f))
        Text(
            value,
            color = skin.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold, mono = mono),
        )
        trailing?.invoke()
    }
}

/** Group create: a name and an icon from the core's `groupIcons()` (the extension's `GROUP_ICONS`). */
@Composable
private fun NewGroupForm(store: WalletStore) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf("folder") }
    GroupFields(name, { name = it }, icon, { icon = it }, label = "New group name")
    PillButton("Create group", kind = PillKind.SECONDARY, icon = BrambleIconName.PLUS, busy = store.busy) {
        if (name.isBlank()) {
            store.showToast("Enter a group name")
        } else {
            scope.launch { if (store.createGroup(name, icon)) name = "" }
        }
    }
}

/** One group: rename and re-icon, its membership across every network, and delete. */
@Composable
private fun GroupEditor(store: WalletStore, group: AccountGroup) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var name by remember(group.id, group.name) { mutableStateOf(group.name) }
    var icon by remember(group.id, group.icon) { mutableStateOf(group.icon) }
    val count = group.accountIds.size
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Text(
            "${group.name} · $count account${if (count == 1) "" else "s"}",
            color = skin.text,
            style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold),
        )
        GroupFields(name, { name = it }, icon, { icon = it }, label = "Group name")
        PillButton("Save group", kind = PillKind.SECONDARY, enabled = name.isNotBlank() && (name != group.name || icon != group.icon)) {
            scope.launch { store.updateGroup(group.id, name, icon) }
        }
        store.allRecords.forEach { record ->
            CheckRow(
                "${record.displayName} · ${record.shortAddress} · ${networkName(record)}",
                checked = record.id in group.accountIds,
                onCheckedChange = { scope.launch { store.toggleMember(record.id, group.id) } },
            )
        }
        PillButton("Delete ${group.name}", kind = PillKind.DANGER) { scope.launch { store.deleteGroup(group.id) } }
    }
}

/** The flat name field and the icon picker a group form shares. */
@Composable
private fun GroupFields(name: String, setName: (String) -> Unit, icon: String, setIcon: (String) -> Unit, label: String) {
    BrambleField(
        label = label,
        placeholder = "Group name",
        value = name,
        onValueChange = { if (it.length <= NAME_LIMIT) setName(it) },
        kind = SecretKind.ADDRESS,
    )
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        groupIcons().forEach { glyph ->
            FilterChip(null, groupIcon(glyph), glyph == icon, description = "Icon $glyph") { setIcon(glyph) }
        }
    }
}

/**
 * "Add a new account" (`flows.ts`, `docs/accounts.md` §2.3): "Regular account" today; Ledger and
 * multisig are hidden, and importing an existing account is shown as coming.
 */
@Composable
fun AddAccountChooser(store: WalletStore, close: () -> Unit, added: () -> Unit) {
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        FlowHeader("Add a new account", network = store.networkLabel, back = close)
        OptionCard(BrambleIconName.WALLET, "Regular account", "Create the next account from this wallet’s recovery phrase.", enabled = !store.busy) {
            scope.launch {
                runCatching { store.addRegularAccount() }
                    .onSuccess { added() }
                    .onFailure(store::showError)
            }
        }
        OptionCard(BrambleIconName.KEY_ROUND, "Import an existing account", "Coming to Bramble mobile.", enabled = false) {}
    }
}
