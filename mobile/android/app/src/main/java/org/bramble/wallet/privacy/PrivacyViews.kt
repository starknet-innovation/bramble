package org.bramble.wallet.privacy

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import org.bramble.core.PoolNotice
import org.bramble.core.PrivacyBlocker
import org.bramble.core.PrivateLine
import org.bramble.core.ShieldTile
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.ActionTile
import org.bramble.wallet.ui.SecondaryButton

/*
 * Privacy surfaces for the Compose app, twins of the iOS PrivacyViews / PrivacyJourneyView. Every
 * decision is the core's; these only spell its answers in the extension's copy.
 *
 * Uncompiled: this machine has no Android SDK; written against the generated Kotlin bindings.
 */

/** The tile's label and accessibility label (`shieldTile`). */
fun ShieldTile.copy(): Pair<String, String> =
    when (this) {
        ShieldTile.NO_STRK_TOKEN -> PrivacyCopy.tileShieldLabel to PrivacyCopy.tileNoTokenAria
        ShieldTile.FUND_FIRST -> PrivacyCopy.tileFundLabel to PrivacyCopy.tileFundAria
        ShieldTile.DEPLOY_AND_ENABLE -> PrivacyCopy.tileDeployLabel to PrivacyCopy.tileDeployLabel
        ShieldTile.ACTIVATE -> PrivacyCopy.tileShieldLabel to PrivacyCopy.tileActivateAria
        ShieldTile.READY -> PrivacyCopy.tileShieldLabel to PrivacyCopy.tileReadyAria
    }

/** The value side of a row's "Private balance" line. */
fun PrivateLine.text(): String =
    when (this) {
        is PrivateLine.Unavailable -> PrivacyCopy.lineUnavailable
        is PrivateLine.FundWithStrk -> PrivacyCopy.tileFundLabel
        is PrivateLine.DeployAndEnable -> PrivacyCopy.tileDeployLabel
        is PrivateLine.Discovering -> PrivacyCopy.lineDiscovering
        is PrivateLine.RegisterToStart -> PrivacyCopy.registerToStart
        is PrivateLine.Amount -> text
    }

/** Title, body and action of the blocked screen; `UNSUPPORTED` is mobile-only copy. */
fun PrivacyBlocker.copy(): Triple<String, String, String> =
    when (this) {
        PrivacyBlocker.DEPLOY -> {
            Triple(PrivacyCopy.blockedDeployTitle, PrivacyCopy.blockedDeployBody, "")
        }

        PrivacyBlocker.FUND -> {
            Triple(PrivacyCopy.blockedFundTitle, PrivacyCopy.blockedFundBody, "")
        }

        PrivacyBlocker.LEDGER -> {
            Triple(PrivacyCopy.blockedLedgerTitle, PrivacyCopy.blockedLedgerBody, "")
        }

        PrivacyBlocker.NETWORK -> {
            Triple(
                PrivacyCopy.blockedNetworkTitle,
                PrivacyCopy.blockedNetworkBody,
                PrivacyCopy.blockedNetworkAction,
            )
        }

        PrivacyBlocker.PENDING -> {
            Triple(PrivacyCopy.blockedPendingTitle, PrivacyCopy.blockedPendingBody, "")
        }

        PrivacyBlocker.SERVICE -> {
            Triple(
                PrivacyCopy.blockedServiceTitle,
                PrivacyCopy.blockedServiceBody,
                PrivacyCopy.blockedServiceAction,
            )
        }

        PrivacyBlocker.UNSUPPORTED -> {
            Triple(PrivacyCopy.unsupportedTitle, PrivacyCopy.unsupportedBody, "")
        }
    }

/** The Home Shield tile: Fund with STRK opens Receive, everything else opens the journey. */
@Composable
fun ShieldActionTile(
    tile: ShieldTile,
    modifier: Modifier = Modifier,
    receive: () -> Unit,
    journey: () -> Unit,
) {
    val (label, accessibility) = tile.copy()
    ActionTile(
        label,
        "⛨",
        enabled = tile != ShieldTile.NO_STRK_TOKEN,
        modifier = modifier.semantics { contentDescription = accessibility },
    ) {
        if (tile == ShieldTile.FUND_FIRST) receive() else journey()
    }
}

/** Receive's "Public transfers only" notice; deploy-first shows text with its action suppressed. */
@Composable
fun PoolNoticeCard(
    notice: PoolNotice,
    journey: () -> Unit,
) {
    val skin = LocalSkin.current
    val (body, action) =
        when (notice) {
            PoolNotice.HIDDEN -> return
            PoolNotice.FUND_FIRST -> PrivacyCopy.noticeFundFirstBody to null
            PoolNotice.DEPLOY_FIRST -> PrivacyCopy.noticeDeployFirstBody to null
            PoolNotice.REGISTER -> PrivacyCopy.noticeRegisterBody to PrivacyCopy.noticeRegisterAction
        }
    Column(
        Modifier
            .fillMaxWidth()
            .background(skin.panel, RoundedCornerShape(BrambleRadius.lg))
            .clickable(enabled = action != null, onClick = journey)
            .padding(horizontal = BrambleSpace.md, vertical = BrambleSpace.sm),
    ) {
        Text(
            PrivacyCopy.noticeTitle,
            color = skin.text,
            style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold),
        )
        Text(body, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        if (action !=
            null
        ) {
            Text(action, color = skin.text, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
        }
    }
}

/** One blocker with its next step (no deploy, fund, pending or unsupported action on mobile). */
@Composable
fun PrivacyBlockedScreen(
    blocker: PrivacyBlocker,
    hint: String?,
    chooseNetwork: () -> Unit,
    retry: () -> Unit,
    back: () -> Unit,
) {
    val skin = LocalSkin.current
    val (title, body, action) = blocker.copy()
    Column(
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
        modifier = Modifier.fillMaxWidth().padding(BrambleSpace.lg),
    ) {
        Text(title, color = skin.text, style = textStyle(BrambleTypeScale.display, BrambleWeight.bold))
        Text(body, color = skin.muted, style = textStyle(BrambleTypeScale.body))
        if (hint != null) Text(hint, color = skin.muted, style = textStyle(BrambleTypeScale.label))
        when (blocker) {
            PrivacyBlocker.NETWORK -> SecondaryButton(action, onClick = chooseNetwork)
            PrivacyBlocker.SERVICE -> SecondaryButton(action, onClick = retry)
            else -> Unit
        }
        SecondaryButton(PrivacyCopy.backToWallet, onClick = back)
    }
}
