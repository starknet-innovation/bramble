package org.bramble.wallet.browser

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.SecureFlagPolicy
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.select
import org.bramble.wallet.ui.wallet.AccountRow
import org.bramble.wallet.visibleRecords

/**
 * The connection card (the extension's `approval-connect-card.ts`), as iOS `ConnectSheet`: the
 * site, its warnings, the account it would see, and Cancel before Connect. The core shares the
 * active account, so choosing another account switches to it first. A blocked site can only be
 * cancelled; only a decision closes the sheet. [decide] gets the approved account's id, or null.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ConnectSheet(
    store: WalletStore,
    card: DappRequestSink.ConnectCard,
    decide: (String?) -> Unit,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val active = store.activeRecord
    ModalBottomSheet(
        onDismissRequest = { /* Only Cancel or Connect closes it. */ },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { false }),
        shape = RoundedCornerShape(topStart = BrambleRadius.xl, topEnd = BrambleRadius.xl),
        containerColor = skin.panel,
        contentColor = skin.text,
        properties =
            ModalBottomSheetProperties(
                securePolicy = SecureFlagPolicy.Inherit,
                shouldDismissOnBackPress = false,
            ),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = BrambleSpace.xl, vertical = BrambleSpace.md),
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        ) {
            Eyebrow(DappCopy.connectTitle)
            Text(
                card.origin,
                color = skin.text,
                style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold, mono = true),
            )
            card.warnings.forEach { StatusLine(it, if (card.blocked) StatusTone.DANGER else StatusTone.MUTED) }
            Text(
                DappCopy.connectAccount,
                color = skin.muted,
                style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold),
            )
            if (store.visibleRecords.isEmpty()) StatusLine(DappCopy.connectSelectAccount)
            store.visibleRecords.forEach { record ->
                val selected = record.id == active?.id
                AccountRow(record, selected) {
                    if (!selected) scope.launch { store.select(record.id) }
                }
            }
            StatusLine(DappCopy.connectShares)
            StatusLine(DappCopy.connectNoFee)
            Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                PillButton(DappCopy.connectCancel, Modifier.weight(1f), kind = PillKind.SECONDARY) { decide(null) }
                PillButton(
                    DappCopy.connectAction,
                    Modifier.weight(1f),
                    icon = BrambleIconName.CHECK,
                    enabled = !card.blocked && active != null && !store.busy,
                ) { decide(active?.id) }
            }
        }
    }
}
