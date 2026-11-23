package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import org.bramble.core.ActivityContact
import org.bramble.core.ActivityFilter
import org.bramble.core.ActivitySort
import org.bramble.core.TxStatus
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.SegmentedControl
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.portfolio.ActivityFeedState
import org.bramble.wallet.portfolio.refilter

/**
 * The names the Activity search resolves on the active network (`activityContacts`): the person's
 * labelled accounts, then the address book. The core matches the first contact whose address is
 * the counterparty's, so an account's own label wins, as in the extension.
 */
fun WalletStore.activityContacts(): List<ActivityContact> {
    val accounts =
        records.filter { it.network == networkInfo.network }.mapNotNull { record ->
            record.label?.let { ActivityContact(record.address, it) }
        }
    return accounts + coordination.contacts.map { ActivityContact(it.address, it.label) }
}

/**
 * `activityToolbar`: the search, the Type, Status and Token selects (each offering only what the
 * feed holds, from the core's options) and the Date / Amount sort. Every change goes to the core
 * through [refilter]; nothing here decides which rows match.
 */
@Composable
internal fun ActivityToolbar(store: WalletStore) {
    val portfolio = store.portfolio
    val feed = portfolio.feed
    val filter = feed.filter
    val apply = { next: ActivityFilter -> portfolio.refilter(filter = next) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        BrambleField(
            label = "Search",
            placeholder = "Address or saved name",
            value = filter.query,
            onValueChange = { apply(filter.copy(query = it)) },
            kind = SecretKind.ADDRESS,
            spokenLabel = "Search activity by address or saved name",
        )
        ActivitySelect(
            "Type",
            listOf<Pair<String, String?>>("All types" to null) + feed.options.actions.map { it to it },
            filter.action,
        ) { apply(filter.copy(action = it)) }
        val statuses = feed.options.statuses.map { statusText(it) to it }
        ActivitySelect("Status", listOf<Pair<String, TxStatus?>>("All statuses" to null) + statuses, filter.status) {
            apply(filter.copy(status = it))
        }
        ActivitySelect(
            "Token",
            listOf<Pair<String, String?>>("All tokens" to null) + feed.options.tokens.map { it.label to it.key },
            filter.token,
        ) { apply(filter.copy(token = it)) }
        SegmentedControl(listOf("Date" to ActivitySort.DATE, "Amount" to ActivitySort.AMOUNT), filter.sort) {
            apply(filter.copy(sort = it))
        }
    }
}

/** The status words the Status select offers (`STATUS_TEXT` in `activity-views.ts`). */
internal fun statusText(status: TxStatus): String =
    when (status) {
        TxStatus.ACCEPTED -> "Accepted"
        TxStatus.PENDING -> "Pending"
        TxStatus.PRECONFIRMED -> "Pre-confirmed"
        TxStatus.REJECTED -> "Rejected"
        TxStatus.REVERTED -> "Reverted"
    }

/**
 * One `selectField`: its [label] and the chosen option's text on the elevated fill, opening a menu
 * of [options] (shown text to value).
 */
@Composable
private fun <T> ActivitySelect(
    label: String,
    options: List<Pair<String, T>>,
    selected: T,
    onSelect: (T) -> Unit,
) {
    val skin = LocalSkin.current
    var open by remember { mutableStateOf(false) }
    val shown = options.firstOrNull { it.second == selected }?.first ?: options.first().first
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = BrambleControl.hit)
                .background(skin.elevated, RoundedCornerShape(BrambleRadius.md))
                .semantics { contentDescription = "$label: $shown" }
                .clickable(role = Role.DropdownList) { open = true }
                .padding(horizontal = BrambleSpace.md),
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
            Text(shown, color = skin.text, style = textStyle(BrambleTypeScale.label), modifier = Modifier.weight(1f))
            BrambleIcon(BrambleIconName.CHEVRON_DOWN, skin.muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = skin.panel) {
            options.forEach { (text, value) ->
                DropdownMenuItem(
                    text = { Text(text, color = skin.text, style = textStyle(BrambleTypeScale.label)) },
                    onClick = {
                        open = false
                        onSelect(value)
                    },
                )
            }
        }
    }
}

/**
 * The counterparty summary above the feed (`#activity-party-summary`) while a search resolves one
 * party: the name (or address) and the core's detail line, both plain text.
 */
@Composable
internal fun PartySummary(feed: ActivityFeedState) {
    val parts = feed.summary ?: return
    val skin = LocalSkin.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(skin.elevated, RoundedCornerShape(BrambleRadius.md))
            .testTag("activity-party-summary")
            .padding(BrambleSpace.md),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
    ) {
        Text(parts.label, color = skin.text, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
        Text(parts.body, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
    }
}
