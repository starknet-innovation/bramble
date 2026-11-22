package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.launch
import org.bramble.core.UnusableAccount
import org.bramble.core.friendlyAccountName
import org.bramble.wallet.ReadyKeyNotice
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.AccountAvatar
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.hiddenRecords
import org.bramble.wallet.setHidden
import org.bramble.wallet.unusableAccounts
import org.bramble.wallet.unusableReasonText

// Manage's hidden and kept accounts and Home's pre-fix Ready key notice (docs/accounts.md §2.4a),
// twin of the iOS sections of the same names. The core decides every state; these only render it.

/** A row's Hide control (`accountNameRow`): the account keeps its key and comes back from "Hidden accounts". */
@Composable
internal fun HideAccountButton(
    store: WalletStore,
    accountId: String,
    address: String,
) {
    // The app's scope: hiding removes this row, which would cancel a composition-bound job after
    // the portfolio was cleared and before the next account's balances load.
    IconButton(BrambleIconName.EYE_OFF, "Hide ${friendlyAccountName(address)}") {
        store.appScope.launch { runCatching { store.setHidden(accountId, true) }.onFailure(store::showError) }
    }
}

/** "Hidden accounts" (`hiddenAccountsSection`): this network's hidden accounts, each with Show. */
@Composable
internal fun HiddenAccountsSection(store: WalletStore) {
    val hidden = store.hiddenRecords
    if (hidden.isEmpty()) return
    Eyebrow("Hidden accounts")
    StatusLine("Hidden accounts stay in the wallet, out of the drawer and send pickers.")
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        hidden.forEach { record ->
            KeptRow(record.address, record.displayName, record.shortAddress) {
                IconButton(BrambleIconName.EYE, "Show ${friendlyAccountName(record.address)}") {
                    store.appScope.launch {
                        runCatching { store.setHidden(record.id, false) }.onFailure(store::showError)
                    }
                }
            }
        }
    }
}

/** The accounts the vault holds that mobile keeps unused (`unusableAccounts`), read-only, each with why. */
@Composable
internal fun UnusableAccountsSection(store: WalletStore) {
    var accounts by remember { mutableStateOf(emptyList<UnusableAccount>()) }
    LaunchedEffect(store.records) { accounts = store.unusableAccounts() }
    if (accounts.isEmpty()) return
    Eyebrow("Not usable on this device")
    StatusLine("These accounts stay in your wallet. Use them in the Bramble extension.")
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        accounts.forEach { account -> KeptRow(account.address, account.shortAddress, unusableReasonText(account)) }
    }
}

/** One read-only account line: avatar, a title, a muted detail, and an optional trailing control. */
@Composable
private fun KeptRow(
    address: String,
    title: String,
    detail: String,
    trailing: (@Composable () -> Unit)? = null,
) {
    val skin = LocalSkin.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = BrambleSize.row).padding(horizontal = BrambleSpace.sm),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AccountAvatar(address)
        Column(
            Modifier.weight(1f).semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap),
        ) {
            Text(title, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text(detail, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        }
        trailing?.invoke()
    }
}

/** The extension's Home notice for the active account when the core marks `preFixReadyKey`. */
@Composable
internal fun ReadyKeyNoticeCard(
    store: WalletStore,
    moveFunds: () -> Unit,
) {
    if (!ReadyKeyNotice.shows(store.activeRecord)) return
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrambleIcon(BrambleIconName.ALERT, skin.muted)
            Text(
                ReadyKeyNotice.TITLE,
                color = skin.text,
                style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold),
            )
        }
        Text(ReadyKeyNotice.BODY, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        PillButton(ReadyKeyNotice.MOVE_FUNDS, kind = PillKind.SECONDARY, onClick = moveFunds)
    }
}
