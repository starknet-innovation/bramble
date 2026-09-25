package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.bramble.core.ActivityDayGroup
import org.bramble.core.ActivityRow
import org.bramble.core.ActivityTone
import org.bramble.core.activityEmptyCopy
import org.bramble.core.activityUnavailableNotice
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSkin
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.refreshSendState
import org.bramble.wallet.ui.CopyButton

/** Milliseconds between feed re-checks while the Activity tab is visible (the iOS 60 s poll). */
private const val ACTIVITY_POLL_MS = 60_000L

/**
 * `activityScreen` from `activity-views.ts`, port of the iOS `ActivityScreen`: the Activity dock
 * for the active account and network, read from the core's one activity store (submitted
 * transactions and on-chain history, grouped by UTC day). Opening the tab reads history when due
 * and settles pending records; the refresh control forces a read; while visible the feed re-checks
 * every 60 s. Export CSV is out of scope, so no control for it is shown.
 */
@Composable
fun ActivityScreen(store: WalletStore) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val portfolio = store.portfolio
    LaunchedEffect(portfolio.scope?.accountId) {
        while (true) {
            portfolio.refreshActivity(force = false)
            store.refreshSendState()
            delay(ACTIVITY_POLL_MS)
        }
    }
    val unavailable = portfolio.activityView?.historyUnavailable == true
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Activity",
                color = skin.text,
                style = textStyle(BrambleTypeScale.title, BrambleWeight.bold),
                modifier =
                    Modifier.weight(1f).semantics {
                        heading()
                        contentDescription = "Activity on ${store.networkInfo.name}"
                    },
            )
            if (portfolio.historyLoading) {
                Box(Modifier.size(BrambleControl.hit), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        color = skin.muted,
                        strokeWidth = BrambleLayout.checkStroke,
                        modifier = Modifier.size(BrambleControl.icon),
                    )
                }
            } else {
                IconButton(BrambleIconName.REFRESH, "Refresh transactions", tint = skin.muted) {
                    scope.launch { portfolio.refreshActivity(force = true) }
                }
            }
        }
        if (unavailable) StatusLine(activityUnavailableNotice())
        ActivityFeed(store, portfolio.groups, unavailable)
    }
}

/** The day groups under their headings, or the core's empty copy when there is nothing yet. */
@Composable
internal fun ActivityFeed(
    store: WalletStore,
    groups: List<ActivityDayGroup>,
    historyUnavailable: Boolean,
) {
    val skin = LocalSkin.current
    if (groups.isEmpty()) {
        Text(
            activityEmptyCopy(historyUnavailable),
            color = skin.muted,
            textAlign = TextAlign.Center,
            style = textStyle(BrambleTypeScale.label),
            modifier =
                Modifier.fillMaxWidth().testTag("activity-empty").padding(
                    vertical = BrambleSpace.lg,
                    horizontal = BrambleSpace.md,
                ),
        )
        return
    }
    groups.forEach { group ->
        Text(
            group.heading,
            color = skin.muted,
            style = textStyle(BrambleTypeScale.body, BrambleWeight.medium),
            modifier = Modifier.semantics { heading() },
        )
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            group.rows.forEach { ActivityRowItem(store, it) }
        }
    }
}

/**
 * `transactionRow`: the kind glyph beside the verb (a link to the explorer in the system
 * browser), the detail line with its copy control, the status word when unsettled, the signed
 * fiat over the amount, and the trailing token mark.
 */
@Composable
private fun ActivityRowItem(
    store: WalletStore,
    row: ActivityRow,
) {
    val skin = LocalSkin.current
    val tone = toneColor(row.tone, skin)
    Row(
        Modifier.fillMaxWidth().padding(vertical = BrambleSpace.sm).testTag("activity-row-${row.hash}"),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            ActivityTitle(row, tone)
            row.detail?.let { detail ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        detail,
                        color = skin.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = textStyle(BrambleTypeScale.body),
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    val counterparty = row.counterparty
                    val copyLabel = row.copyLabel
                    // The one clipboard path: public address only, expiring, confirmed by the store.
                    if (counterparty != null && copyLabel != null) CopyButton(store, counterparty, copyLabel)
                }
            }
            row.statusWord?.let {
                Text(it, color = tone, maxLines = 1, style = textStyle(BrambleTypeScale.caption, BrambleWeight.medium))
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            Text(
                row.fiatText ?: "—",
                color = if (row.fiatText == null) skin.muted else skin.text,
                maxLines = 1,
                style = textStyle(BrambleTypeScale.row, BrambleWeight.medium).copy(fontFeatureSettings = "tnum"),
            )
            Text(
                row.amountText ?: "—",
                color = skin.muted,
                maxLines = 1,
                style = textStyle(BrambleTypeScale.body).copy(fontFeatureSettings = "tnum"),
            )
        }
        val address = row.tokenAddress
        if (address != null) TokenMark(address, row.tokenSymbol ?: "")
    }
}

/** The glyph and the verb; with an explorer URL the verb is a link that opens the system browser. */
@Composable
private fun ActivityTitle(
    row: ActivityRow,
    tone: Color,
) {
    val skin = LocalSkin.current
    val uri = LocalUriHandler.current
    val link = row.explorerUrl
    val linkModifier =
        if (link != null) {
            Modifier
                .testTag("activity-link-${row.hash}")
                .clickable(onClickLabel = "Open in explorer", role = Role.Button) { uri.openUri(link) }
        } else {
            Modifier
        }
    Row(
        linkModifier.semantics(mergeDescendants = true) { contentDescription = row.accessibilityLabel },
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val glyphTint = if (row.tone == ActivityTone.SETTLED) skin.text else tone
        BrambleIcon(activityIcon(row.icon), glyphTint, BrambleLayout.detailIcon)
        Text(
            row.title,
            color = skin.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = textStyle(BrambleTypeScale.row, BrambleWeight.medium),
        )
    }
}

/** The status ink for a row's [tone]: muted when settled, warning, positive or danger otherwise. */
private fun toneColor(
    tone: ActivityTone,
    skin: BrambleSkin,
): Color =
    when (tone) {
        ActivityTone.SETTLED -> skin.muted
        ActivityTone.PENDING -> skin.warning
        ActivityTone.PRECONFIRMED -> skin.positive
        ActivityTone.FAILED -> skin.danger
    }

/**
 * The generated icon for the core's glyph [name] (`ActivityRow.icon`, the iOS asset's camel-case
 * name such as `arrowDownLeft`), or the layout grid for a name this build does not know.
 */
fun activityIcon(name: String): BrambleIconName {
    val constant = name.replace(Regex("([a-z0-9])([A-Z])"), "$1_$2").uppercase()
    return BrambleIconName.entries.firstOrNull { it.name == constant } ?: BrambleIconName.LAYOUT_GRID
}
