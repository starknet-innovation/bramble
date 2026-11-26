package org.bramble.wallet.browser

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.SecureFlagPolicy
import kotlinx.coroutines.delay
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
import org.bramble.wallet.ui.shortAddress

// ponytail: the extension has no tap delay; 500 ms against a page timing a tap onto Sign.
private const val ARM_DELAY_MS = 500L

/**
 * The typed-data sign card (the extension's `approval-cards.ts` sign card), as iOS `SignSheet`:
 * the site and its warnings, what it asks, the account that signs, the risks, the exact document,
 * then Deny before Sign. The core reviewed it for [sign]'s account and re-checks everything at
 * approval. A card paying or approving a lookalike, or from a blocked site, can only be denied;
 * only a decision closes the sheet. [decide] gets true for Sign; [leave] denies and closes the
 * browser, so a site that keeps asking cannot hold the person here.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SignSheet(
    store: WalletStore,
    card: DappRequestSink.Card,
    sign: DappRequestSink.SignRequest,
    leave: () -> Unit,
    decide: (Boolean) -> Unit,
) {
    val skin = LocalSkin.current
    var armed by remember(card.id) { mutableStateOf(false) }
    LaunchedEffect(card.id) {
        delay(ARM_DELAY_MS)
        armed = true
    }
    ModalBottomSheet(
        onDismissRequest = { /* Only Deny or Sign closes it. */ },
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
            Eyebrow(DappCopy.signTitle)
            Text(
                card.origin,
                color = skin.text,
                style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold, mono = true),
            )
            card.warnings.forEach { StatusLine(it, if (card.blocked) StatusTone.DANGER else StatusTone.MUTED) }
            StatusLine(DappCopy.signHint)
            Text(sign.summary, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
            SigningAccount(store, sign)
            StatusLine(DappCopy.signOutcome)
            sign.calls.forEach { StatusLine(it) }
            signRisks(sign).forEach { StatusLine(it, StatusTone.DANGER) }
            Document(sign.document)
            StatusLine(DappCopy.signConstraints)
            SignDecisions(sign.poisoned, armed && !card.blocked && !store.busy, decide)
            PillButton(DappCopy.leaveSite, Modifier.fillMaxWidth(), kind = PillKind.GHOST, onClick = leave)
        }
    }
}

/** The review's flags, then the outside-execution warning when it authorizes later calls. */
private fun signRisks(sign: DappRequestSink.SignRequest): List<String> =
    sign.risks + if (sign.outsideExecution) listOf(DappCopy.signOutsideExecution) else emptyList()

/** The account the core signs with: its name when this wallet lists it, and its address. */
@Composable
private fun SigningAccount(
    store: WalletStore,
    sign: DappRequestSink.SignRequest,
) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        Text(
            DappCopy.connectAccount,
            color = skin.muted,
            style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold),
        )
        store.records.firstOrNull { it.id == sign.accountId }?.let {
            Text(it.displayName, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
        }
        Text(shortAddress(sign.address), color = skin.muted, style = textStyle(BrambleTypeScale.body, mono = true))
    }
}

/** The exact document the core hashes, selectable. */
@Composable
private fun Document(document: String) {
    val skin = LocalSkin.current
    Text(DappCopy.signRaw, color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
    SelectionContainer {
        Text(
            document,
            color = skin.text,
            style = textStyle(BrambleTypeScale.caption, mono = true),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .background(skin.bg, RoundedCornerShape(BrambleRadius.md))
                    .padding(BrambleSpace.sm),
        )
    }
}

/** Deny before Sign ([signable] enables it); a [poisoned] card says why and offers Deny only. */
@Composable
private fun SignDecisions(
    poisoned: Boolean,
    signable: Boolean,
    decide: (Boolean) -> Unit,
) {
    if (poisoned) {
        StatusLine(DappCopy.signWontSend, StatusTone.DANGER)
        PillButton(DappCopy.signDeny, Modifier.fillMaxWidth(), kind = PillKind.SECONDARY) { decide(false) }
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        PillButton(DappCopy.signDeny, Modifier.weight(1f), kind = PillKind.SECONDARY) { decide(false) }
        PillButton(DappCopy.signAction, Modifier.weight(1f), icon = BrambleIconName.CHECK, enabled = signable) {
            decide(true)
        }
    }
}

/** Shown in place of a page the blocklist refused to load: the site and why, and Leave site. */
@Composable
internal fun BlockedSitePanel(
    origin: String,
    leave: () -> Unit,
) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Text(origin, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold, mono = true))
        StatusLine(DappCopy.siteInsightBlocklisted, StatusTone.DANGER)
        PillButton(DappCopy.leaveSite, Modifier.fillMaxWidth(), kind = PillKind.SECONDARY, onClick = leave)
    }
}
