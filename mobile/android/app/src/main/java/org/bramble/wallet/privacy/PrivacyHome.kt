package org.bramble.wallet.privacy

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.launch
import org.bramble.core.HomePrivateRow
import org.bramble.core.PrivacyStatus
import org.bramble.core.homePrivateRow
import org.bramble.core.privacyStatus
import org.bramble.core.shieldedBalancesIncluded
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle

// Home's private-balance surfaces, port of the iOS `ShieldedHeroLabel`, `PrivacyRetryRow` and the
// header's `privacyStatusText`. The core decides each (`privacyStatus`, `shieldedBalancesIncluded`).

/** `privacyDataIssue`: the core's private-balance status for the active reading. */
val WalletStore.privacyHeaderStatus: PrivacyStatus get() = privacyStatus(network, privacy.reading)

/** Home's private-balances row under the token list: the retry, the no-pool answer, or none. */
val WalletStore.privacyHomeRow: HomePrivateRow get() = homePrivateRow(network, privacy.reading)

/** The header's spoken private-balance status, or null while the reading is current. */
val WalletStore.privacyStatusText: String?
    get() =
        when (privacyHeaderStatus) {
            PrivacyStatus.CURRENT -> null
            PrivacyStatus.REFRESHING -> PrivacyCopy.statusRefreshing
            PrivacyStatus.UNAVAILABLE -> PrivacyCopy.statusUnavailable
        }

/** `.hero-stale`: "Includes shielded balances" under the total, when the total counts any. */
@Composable
fun ShieldedHeroLabel(store: WalletStore) {
    val included =
        shieldedBalancesIncluded(store.privacy.reading, store.privacy.state, store.portfolio.hiddenTokenAddresses)
    if (!included) return
    val skin = LocalSkin.current
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrambleIcon(BrambleIconName.LOCK, skin.muted, BrambleLayout.privacyLockIcon)
        Text(PrivacyCopy.heroShielded, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
    }
}

/**
 * `data-privacy-retry`: "Private balances · Try again" under the list after a failed read, or
 * "Not available on this network" in its place, without a retry, where no pool is configured.
 */
@Composable
fun PrivacyRetryRow(store: WalletStore) {
    val row = store.privacyHomeRow
    if (row == HomePrivateRow.NONE) return
    val retry = row == HomePrivateRow.RETRY
    val value = if (retry) PrivacyCopy.retry else PrivacyCopy.blockedNetworkTitle
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val pressable =
        if (retry) {
            Modifier.fillPress(Color.Transparent, skin.softPress, RectangleShape, pressedScale = 1f) {
                scope.launch { store.refreshPrivacy() }
            }
        } else {
            Modifier
        }
    Row(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {
                contentDescription = "${PrivacyCopy.privateBalances}, $value"
            }.then(pressable)
            .heightIn(min = BrambleControl.hit)
            .padding(horizontal = BrambleSpace.sm),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrambleIcon(BrambleIconName.LOCK, skin.muted, BrambleLayout.privacyLockIcon)
        Text(
            PrivacyCopy.privateBalances,
            color = skin.muted,
            style = textStyle(BrambleTypeScale.label),
            modifier = Modifier.weight(1f),
        )
        Text(value, color = skin.muted, style = textStyle(BrambleTypeScale.label))
    }
}
