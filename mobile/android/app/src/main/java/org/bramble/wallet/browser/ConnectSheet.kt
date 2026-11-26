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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.SecureFlagPolicy
import kotlinx.coroutines.delay
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

// ponytail: the extension has no tap delay; 500 ms against a page timing a tap onto Connect.
private const val ARM_DELAY_MS = 500L

/**
 * The connection card (the extension's `approval-connect-card.ts`), as iOS `ConnectSheet`: the
 * site, its warnings, the account it would see, and Cancel before Connect. The core shares the
 * active account, so choosing another account switches to it first. A blocked site can only be
 * cancelled; only a decision closes the sheet. [decide] gets the approved account's id, or null;
 * [leave] cancels and closes the browser, so a site that keeps asking cannot hold the person here.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ConnectSheet(
    store: WalletStore,
    card: DappRequestSink.Card,
    leave: () -> Unit,
    decide: (String?) -> Unit,
) {
    val skin = LocalSkin.current
    var armed by remember(card.id) { mutableStateOf(false) }
    LaunchedEffect(card.id) {
        delay(ARM_DELAY_MS)
        armed = true
    }
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
            AccountChoices(store)
            StatusLine(DappCopy.connectShares)
            StatusLine(DappCopy.connectNoFee)
            Decisions(connectable = armed && !card.blocked && active != null && !store.busy, leave = leave) { connect ->
                decide(if (connect) active?.id else null)
            }
        }
    }
}

/** The accounts on this network; choosing one makes it active, the one the core shares. */
@Composable
private fun AccountChoices(store: WalletStore) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val active = store.activeRecord
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
}

/** Cancel before Connect ([connectable] enables it), then Leave site. [decide] gets true for Connect. */
@Composable
private fun Decisions(
    connectable: Boolean,
    leave: () -> Unit,
    decide: (Boolean) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        PillButton(DappCopy.connectCancel, Modifier.weight(1f), kind = PillKind.SECONDARY) { decide(false) }
        PillButton(
            DappCopy.connectAction,
            Modifier.weight(1f),
            icon = BrambleIconName.CHECK,
            enabled = connectable,
        ) { decide(true) }
    }
    PillButton(DappCopy.leaveSite, Modifier.fillMaxWidth(), kind = PillKind.GHOST, onClick = leave)
}
