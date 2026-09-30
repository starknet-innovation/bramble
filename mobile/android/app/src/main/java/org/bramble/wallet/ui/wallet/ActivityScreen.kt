package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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
import org.bramble.wallet.design.BrambleRadius
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
import org.bramble.wallet.send.SendCopy
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
 * `transactionRow`, a disclosure. The summary: the kind glyph (hidden from assistive tech, its
 * tone the status), the heading that joins verb and amount, the truncated hash (a link to the
 * explorer in the system browser when there is one) with its copy control, the status word for a
 * row that is not accepted, the token mark, and the disclosure chevron. The expansion: the
 * counterparty (or the Detail fact), then Submitted and Status. No fiat figure: a value from
 * today's price is not what the transaction was worth.
 */
@Composable
private fun ActivityRowItem(
    store: WalletStore,
    row: ActivityRow,
) {
    var open by remember(row.hash) { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(BrambleRadius.lg))
            .testTag("activity-row-${row.hash}"),
    ) {
        ActivitySummary(store, row, open) { open = !open }
        if (open) ActivityFacts(store, row)
    }
}

/** The disclosure's summary row; tapping it (outside its controls) toggles the facts. */
@Composable
private fun ActivitySummary(
    store: WalletStore,
    row: ActivityRow,
    open: Boolean,
    toggle: () -> Unit,
) {
    val skin = LocalSkin.current
    val tone = toneColor(row.tone, skin)
    Row(
        Modifier
            .fillMaxWidth()
            .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
            .clickable(
                onClickLabel = if (open) "Hide details" else "Show details",
                role = Role.Button,
                onClick = toggle,
            ).padding(vertical = BrambleSpace.sm),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val glyphTint = if (row.tone == ActivityTone.SETTLED) skin.text else tone
        Box(Modifier.clearAndSetSemantics {}) {
            BrambleIcon(activityIcon(row.icon), glyphTint, BrambleLayout.detailIcon)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(
                row.heading,
                color = skin.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = textStyle(BrambleTypeScale.row, BrambleWeight.medium),
                modifier = Modifier.semantics { contentDescription = row.accessibilityLabel },
            )
            ActivityHash(store, row)
        }
        row.statusWord?.let {
            Text(it, color = tone, maxLines = 1, style = textStyle(BrambleTypeScale.caption, BrambleWeight.medium))
        }
        TokenMark(row.avatar)
        BrambleIcon(
            BrambleIconName.CHEVRON_RIGHT,
            skin.muted,
            modifier = Modifier.rotate(if (open) DISCLOSURE_OPEN_DEGREES else 0f),
        )
    }
}

/** The truncated hash, linked to the explorer when the row has a link, and its copy control. */
@Composable
private fun ActivityHash(
    store: WalletStore,
    row: ActivityRow,
) {
    val skin = LocalSkin.current
    val uri = LocalUriHandler.current
    val link = row.explorerUrl
    Row(verticalAlignment = Alignment.CenterVertically) {
        val linked =
            if (link != null) {
                Modifier
                    .testTag("activity-link-${row.hash}")
                    .semantics { contentDescription = SendCopy.explorerLinkLabel }
                    .clickable(role = Role.Button) { uri.openUri(link) }
            } else {
                Modifier
            }
        Text(
            row.hashLabel,
            color = if (link != null) skin.accent else skin.muted,
            maxLines = 1,
            style = textStyle(BrambleTypeScale.caption, mono = true),
            modifier = linked,
        )
        CopyButton(store, row.hash, row.hashCopyLabel)
    }
}

/**
 * The expansion's facts: the counterparty (its role, the 6…4 address and a copy control carrying
 * the full one), or the Detail fact; then Submitted and Status, each only when the row has it.
 */
@Composable
private fun ActivityFacts(
    store: WalletStore,
    row: ActivityRow,
) {
    Column(
        Modifier.fillMaxWidth().padding(start = BrambleLayout.taskHairlineInset, bottom = BrambleSpace.sm),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
    ) {
        val counterparty = row.counterparty
        if (counterparty != null) {
            ActivityFact(counterparty.role, counterparty.addressLabel, mono = true) {
                // The one clipboard path: public address only, expiring, confirmed by the store.
                CopyButton(store, counterparty.address, counterparty.copyLabel)
            }
        } else {
            row.detail?.let { ActivityFact(DETAIL_LABEL, it) }
        }
        row.submitted?.let { ActivityFact(SUBMITTED_LABEL, it) }
        row.statusHint?.let { ActivityFact(STATUS_LABEL, it) }
    }
}

/** One `dt`/`dd` pair of the expansion, with an optional trailing control. */
@Composable
private fun ActivityFact(
    label: String,
    value: String,
    mono: Boolean = false,
    control: @Composable () -> Unit = {},
) {
    val skin = LocalSkin.current
    Row(
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
        Text(
            value,
            color = skin.text,
            style = textStyle(BrambleTypeScale.caption, mono = mono),
            modifier = Modifier.weight(1f, fill = false),
        )
        control()
    }
}

/** The expansion's fixed fact labels (`transactionRow`'s `dt`s). */
private const val DETAIL_LABEL = "Detail"
private const val SUBMITTED_LABEL = "Submitted"
private const val STATUS_LABEL = "Status"

/** The disclosure chevron's turn while the row is open. */
private const val DISCLOSURE_OPEN_DEGREES = 90f

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
