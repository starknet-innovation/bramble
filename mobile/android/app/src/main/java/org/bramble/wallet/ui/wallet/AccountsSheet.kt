package org.bramble.wallet.ui.wallet

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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.window.SecureFlagPolicy
import kotlinx.coroutines.launch
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
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.shortAddress

/**
 * The account drawer (`account-drawer.ts`), port of the iOS `AccountsSheet`: title with the
 * network, account rows with the selected one on accent-soft and a check, then "Add account".
 * The sheet is its own window, so it inherits `FLAG_SECURE` explicitly (`SecureFlagPolicy.Inherit`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountsSheet(store: WalletStore, onDismiss: () -> Unit) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState()
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
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                    Text("Accounts", color = skin.text, style = textStyle(BrambleTypeScale.display, BrambleWeight.bold, BrambleTracking.display))
                    Text(store.networkInfo.name, color = skin.muted, style = textStyle(BrambleTypeScale.body))
                }
                IconButton(BrambleIconName.X, "Close", tint = skin.muted, onClick = close)
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                if (store.accounts.isEmpty()) {
                    Text("No accounts on this network yet. Add one below.", color = skin.muted, style = textStyle(BrambleTypeScale.label))
                }
                store.accounts.forEach { account ->
                    val selected = account.index == store.account?.index
                    Row(
                        Modifier.fillMaxWidth()
                            .semantics(mergeDescendants = true) { this.selected = selected }
                            .fillPress(
                                if (selected) skin.accentSoft else Color.Transparent,
                                skin.softPress,
                                RoundedCornerShape(BrambleRadius.lg),
                                pressedScale = 1f,
                            ) {
                                scope.launch { store.select(account.index) }
                                close()
                            }
                            .heightIn(min = BrambleSize.row)
                            .padding(horizontal = BrambleSpace.sm),
                        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AccountAvatar(account.address)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                            Text("Account ${account.index + 1u}", color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
                            Text(
                                shortAddress(account.address),
                                color = skin.muted,
                                style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold, mono = true),
                            )
                        }
                        if (selected) BrambleIcon(BrambleIconName.CHECK, skin.accent)
                    }
                }
            }
            PillButton("Add account", kind = PillKind.SECONDARY, icon = BrambleIconName.PLUS, busy = store.busy) {
                scope.launch {
                    runCatching { store.addAccount() }
                        .onSuccess { close() }
                        .onFailure(store::showError)
                }
            }
        }
    }
}
