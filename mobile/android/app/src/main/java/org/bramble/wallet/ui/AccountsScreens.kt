package org.bramble.wallet.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.bramble.core.AccountRecord
import org.bramble.core.accountLabel
import org.bramble.core.copyFeedback
import org.bramble.core.groupIcons
import org.bramble.wallet.*
import org.bramble.wallet.design.*

// The account drawer, the add-account chooser, and "Accounts & groups": Compose twins of the iOS
// AccountsSheet.swift / AccountsManageView.swift / GroupsSection.swift, with the extension's copy.
// UNCOMPILED: written against the generated Kotlin bindings; there is no Android SDK here.

/** `[data-copy]`: copies the full value; the platform confirms on API 33+, a toast otherwise. */
@Composable
fun CopyControl(value: String, label: String) {
    val context = LocalContext.current
    val skin = LocalSkin.current
    var confirmed by remember { mutableStateOf(false) }
    LaunchedEffect(confirmed) {
        if (confirmed) {
            delay(copyFeedback().confirmMs.toLong())
            confirmed = false
        }
    }
    Text(
        if (confirmed) "✓" else "⧉",
        color = if (confirmed) skin.positive else skin.muted,
        style = textStyle(BrambleTypeScale.title),
        modifier = Modifier.semantics { contentDescription = label }
            .clickable {
                val systemConfirms = Clipboard.copy(context, value)
                if (!systemConfirms) Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
                confirmed = true
            }
            .padding(BrambleSpace.sm),
    )
}

@Composable
private fun AccountRow(record: AccountRecord, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Row(
        modifier.fillMaxWidth().heightIn(min = BrambleSize.row)
            .background(if (selected) skin.accentSoft else skin.panel, RoundedCornerShape(BrambleRadius.lg))
            .clickable(onClick = onClick)
            .semantics(mergeDescendants = true) { stateDescription = record.address; this.selected = selected }
            .padding(horizontal = BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        AccountAvatar(record.accountIndex)
        Column(Modifier.weight(1f)) {
            Text(record.displayName, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text(record.shortAddress, color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold, mono = true))
        }
        if (selected) Text("✓", color = skin.accent, style = textStyle(BrambleTypeScale.row, BrambleWeight.bold))
    }
}

/** `account-drawer.ts`: chips when groups exist, this network's rows (no copy), add, manage. */
@Composable
fun AccountsDrawer(store: WalletStore, close: () -> Unit, openManage: () -> Unit) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var filter by remember { mutableStateOf<String?>(null) }
    var openAssign by remember { mutableStateOf<String?>(null) }
    var choosing by remember { mutableStateOf(false) }
    if (choosing) return AddAccountChooser(store, close = { choosing = false }, added = close)
    val activeGroup = store.groups.firstOrNull { it.id == filter }
    val visible = activeGroup?.let { group -> store.records.filter { it.id in group.accountIds } } ?: store.records
    Column(Modifier.fillMaxSize().padding(BrambleSpace.xl), verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Accounts", color = skin.text, style = textStyle(BrambleTypeScale.display, BrambleWeight.bold, BrambleTracking.display))
                Text(store.networkInfo.name, color = skin.muted, style = textStyle(BrambleTypeScale.body))
            }
            Text("✕", color = skin.muted, modifier = Modifier.semantics { contentDescription = "Close accounts" }.clickable(onClick = close).padding(BrambleSpace.sm))
        }
        if (store.groups.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            Chip("All", filter == null) { filter = null }
            store.groups.forEach { group -> Chip(group.name, filter == group.id) { filter = group.id } }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            if (visible.isEmpty()) Text(
                if (activeGroup == null) "No accounts on this network yet. Add one below."
                else "No accounts in this group yet. Open an account's folder button to add it.",
                color = skin.muted, style = textStyle(BrambleTypeScale.body),
            )
            visible.forEach { record ->
                val folder = store.groups.firstOrNull { it.id == record.groupId }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AccountRow(record, record.id == store.activeRecord?.id, Modifier.weight(1f)) {
                        scope.launch { store.select(record.id) }
                        close()
                    }
                    val pickerLabel = folder?.let { "Folder: ${it.name}" } ?: "No folder — choose one"
                    Text(folder?.icon ?: "folder", color = skin.muted, style = textStyle(BrambleTypeScale.caption),
                        modifier = Modifier.semantics { contentDescription = "$pickerLabel for ${record.displayName}" }
                            .clickable { openAssign = if (openAssign == record.id) null else record.id }.padding(BrambleSpace.sm))
                }
                if (openAssign == record.id) Card {
                    (store.groups.map { it.id to it.name } + (null to "None")).forEach { (id, name) ->
                        Text(if (id == folder?.id) "✓ $name" else name, color = skin.text, style = textStyle(BrambleTypeScale.body),
                            modifier = Modifier.fillMaxWidth().clickable {
                                scope.launch { store.setGroup(id, record.id) }
                                openAssign = null
                            }.padding(BrambleSpace.sm))
                    }
                }
            }
        }
        SecondaryButton("Add account") { choosing = true }
        SecondaryButton("Manage accounts & groups") { close(); openManage() }
    }
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Text(label, color = if (selected) skin.text else skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold),
        modifier = Modifier.background(if (selected) skin.accentSoft else skin.elevated, RoundedCornerShape(BrambleRadius.full))
            .semantics { this.selected = selected }.clickable(onClick = onClick)
            .padding(horizontal = BrambleSpace.md, vertical = BrambleSpace.xs))
}

/** `addAccountChooser`: "Regular account" today; importing is shown as coming. */
@Composable
fun AddAccountChooser(store: WalletStore, close: () -> Unit, added: () -> Unit) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(BrambleSpace.xl), verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Add a new account", color = skin.text, style = textStyle(BrambleTypeScale.display, BrambleWeight.bold), modifier = Modifier.weight(1f))
            Text("✕", color = skin.muted, modifier = Modifier.semantics { contentDescription = "Close Add account" }.clickable(onClick = close).padding(BrambleSpace.sm))
        }
        Card {
            Text("Regular account", color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text("Create the next account from this wallet’s recovery phrase.", color = skin.muted, style = textStyle(BrambleTypeScale.caption))
            PrimaryButton("Regular account", busy = store.busy) {
                scope.launch { runCatching { store.addRegularAccount() }.onSuccess { added() }.onFailure { store.toast = describe(it) to false } }
            }
        }
        Card {
            Text("Import an existing account", color = skin.muted, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text("Coming to Bramble mobile.", color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        }
    }
}

/** "Accounts & groups" (`accountFlow`): pick with inline copy, groups, then the active receipt. */
@Composable
fun ManageAccounts(store: WalletStore, close: () -> Unit) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val active = store.activeRecord
    var label by remember(active?.id) { mutableStateOf(active?.label ?: "") }
    var newGroup by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf("folder") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(BrambleSpace.lg), verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        SecondaryButton("Back", onClick = close)
        Text("Accounts & groups", color = skin.text, style = textStyle(BrambleTypeScale.headline, BrambleWeight.bold))
        Text("ACCOUNTS", color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
        store.records.forEach { record ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                AccountRow(record, record.id == active?.id, Modifier.weight(1f)) { scope.launch { store.select(record.id) } }
                CopyControl(record.address, "Copy ${record.displayName} address")
            }
        }
        Text("GROUPS", color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
        Card {
            BrambleField("New group name", newGroup, { if (it.length <= 64) newGroup = it })
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                groupIcons().forEach { glyph -> Chip(glyph, glyph == icon) { icon = glyph } }
            }
            SecondaryButton("Create group") {
                if (newGroup.isBlank()) store.toast = "Enter a group name" to false
                else scope.launch { if (store.createGroup(newGroup, icon)) newGroup = "" }
            }
        }
        store.groups.forEach { group ->
            Card {
                Text("${group.name} · ${group.accountIds.size} account${if (group.accountIds.size == 1) "" else "s"}",
                    color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
                store.allRecords.forEach { record ->
                    val member = record.id in group.accountIds
                    Text((if (member) "✓ " else "+ ") + "${record.displayName} · ${record.shortAddress} · ${networkName(record)}",
                        color = skin.text, style = textStyle(BrambleTypeScale.body),
                        modifier = Modifier.fillMaxWidth().clickable { scope.launch { store.toggleMember(record.id, group.id) } }.padding(BrambleSpace.xs))
                }
                SecondaryButton("Delete ${group.name}", destructive = true) { scope.launch { store.deleteGroup(group.id) } }
            }
        }
        if (active != null) {
            Text("ACTIVE ACCOUNT", color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
            BrambleField("Name", label, { if (it.length <= 64) label = it })
            Text("Shown instead of the address. Leave empty to clear.", color = skin.muted, style = textStyle(BrambleTypeScale.caption))
            SecondaryButton("Save name") { scope.launch { store.saveLabel(label, active.id) } }
            Card {
                Receipt("Address", active.shortAddress, active.address, "Copy address")
                Receipt("Signer public key", accountLabel(active.publicKey), active.publicKey, "Copy signer public key")
                Receipt("Class hash", accountLabel(active.classHash), active.classHash, "Copy class hash")
                active.typeLabel?.let { Receipt("Type", it, null, null) }
            }
        }
    }
}

@Composable
private fun Receipt(label: String, value: String, copy: String?, copyLabel: String?) {
    val skin = LocalSkin.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
            Text(value, color = skin.text, style = textStyle(BrambleTypeScale.body, mono = copy != null))
        }
        if (copy != null && copyLabel != null) CopyControl(copy, copyLabel)
    }
}
