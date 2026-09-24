package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalBottomSheetProperties
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.window.SecureFlagPolicy
import kotlinx.coroutines.launch
import org.bramble.core.AccountRecord
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.AccountAvatar
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTracking
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.FilterChip
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.select
import org.bramble.wallet.setGroup

/**
 * The account drawer (`shell/account-drawer.ts`, `docs/accounts.md` §2.2), port of the iOS
 * `AccountsSheet`: title with the network, group filter chips (only when a group exists), this
 * network's rows (display name, 6…4 address, active on accent-soft with a check, no copy) each with
 * its folder picker, the empty states, then "Add account" (the chooser, §2.3) and "Manage accounts
 * & groups". The sheet is its own window, so it inherits `FLAG_SECURE` explicitly.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountsSheet(store: WalletStore, onDismiss: () -> Unit, openManage: () -> Unit, openMultisig: () -> Unit = {}) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState()
    var choosing by remember { mutableStateOf(false) }
    val close: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = BrambleRadius.xl, topEnd = BrambleRadius.xl),
        containerColor = skin.panel,
        contentColor = skin.text,
        properties = ModalBottomSheetProperties(securePolicy = SecureFlagPolicy.Inherit),
    ) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(start = BrambleSpace.xl, end = BrambleSpace.xl, bottom = BrambleSpace.xl),
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
        ) {
            if (choosing) {
                AddAccountChooser(store, close = { choosing = false }, added = close, multisig = { close(); openMultisig() })
            } else {
                DrawerContent(store, close, openManage = { close(); openManage() }, add = { choosing = true })
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.DrawerContent(
    store: WalletStore,
    close: () -> Unit,
    openManage: () -> Unit,
    add: () -> Unit,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var filter by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf<String?>(null) }
    val activeGroup = store.groups.firstOrNull { it.id == filter }
    val visible = activeGroup?.let { group -> store.records.filter { it.id in group.accountIds } } ?: store.records
    Row(verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text("Accounts", color = skin.text, style = textStyle(BrambleTypeScale.display, BrambleWeight.bold, BrambleTracking.display))
            Text(store.networkInfo.name, color = skin.muted, style = textStyle(BrambleTypeScale.body))
        }
        IconButton(BrambleIconName.X, "Close accounts", tint = skin.muted, onClick = close)
    }
    if (store.groups.isNotEmpty()) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            FilterChip("All", BrambleIconName.WALLET, filter == null) { filter = null }
            store.groups.forEach { group ->
                FilterChip(group.name, groupIcon(group.icon), filter == group.id) { filter = group.id }
            }
        }
    }
    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        if (visible.isEmpty()) {
            Text(
                if (activeGroup == null) "No accounts on this network yet. Add one below."
                else "No accounts in this group yet. Open an account's folder button to add it.",
                color = skin.muted,
                style = textStyle(BrambleTypeScale.label),
            )
        }
        visible.forEach { record ->
            val folder = store.groups.firstOrNull { it.id == record.groupId }
            Row(verticalAlignment = Alignment.CenterVertically) {
                AccountRow(record, record.id == store.activeRecord?.id, Modifier.weight(1f)) {
                    scope.launch { runCatching { store.select(record.id) }.onFailure(store::showError) }
                    close()
                }
                IconButton(
                    groupIcon(folder?.icon ?: "folder"),
                    "${folder?.let { "Folder: ${it.name}" } ?: "No folder — choose one"} for ${record.displayName}",
                    tint = skin.muted,
                ) { picking = if (picking == record.id) null else record.id }
            }
            if (picking == record.id) {
                // Single-select folder picker: every group, then "None".
                MenuGroup {
                    val options: List<Triple<String?, String, BrambleIconName>> =
                        store.groups.map { Triple(it.id, it.name, groupIcon(it.icon)) } + Triple(null, "None", BrambleIconName.FOLDER)
                    options.forEachIndexed { offset, (id, name, icon) ->
                        if (offset > 0) MenuDivider()
                        MenuRow(icon, name, selected = id == folder?.id, chevron = false) {
                            picking = null
                            scope.launch { store.setGroup(record.id, id) }
                        }
                    }
                }
            }
        }
    }
    PillButton("Add account", kind = PillKind.SECONDARY, icon = BrambleIconName.PLUS, onClick = add)
    MenuGroup { MenuRow(BrambleIconName.SETTINGS, "Manage accounts & groups", onClick = openManage) }
}

/** `.account-row`: avatar, display name over the 6…4 address; the full address is the a11y value. */
@Composable
internal fun AccountRow(record: AccountRecord, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Row(
        modifier.fillMaxWidth()
            .semantics(mergeDescendants = true) {
                this.selected = selected
                stateDescription = record.address
            }
            .fillPress(if (selected) skin.accentSoft else Color.Transparent, skin.softPress, RoundedCornerShape(BrambleRadius.lg), pressedScale = 1f, onClick = onClick)
            .heightIn(min = BrambleSize.row)
            .padding(horizontal = BrambleSpace.sm),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AccountAvatar(record.address)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(record.displayName, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text(record.shortAddress, color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold, mono = true))
        }
        if (selected) BrambleIcon(BrambleIconName.CHECK, skin.accent)
    }
}

/** A group icon name from the core's `groupIcons()` ("piggy-bank") as a bundled icon; `folder` otherwise. */
internal fun groupIcon(name: String): BrambleIconName {
    val key = name.uppercase().replace('-', '_')
    return BrambleIconName.entries.firstOrNull { it.name == key } ?: BrambleIconName.FOLDER
}
