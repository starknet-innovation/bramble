package org.bramble.wallet.privacy

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.launch
import org.bramble.core.DetailAction
import org.bramble.core.DetailSummary
import org.bramble.core.TokenDetailPrivacy
import org.bramble.core.privacyCapabilities
import org.bramble.core.tokenDetailPrivacy
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.strkFunded

/**
 * The core's answer for [tokenAddress]'s private half on token detail (`tokenDetailPrivacy`),
 * from the store's real deployment judgement, STRK funding and privacy reading.
 */
fun WalletStore.tokenDetailPrivacyFor(tokenAddress: String): TokenDetailPrivacy =
    tokenDetailPrivacy(network, deployment, strkFunded, privacy.reading, tokenAddress, privacy.state)

/**
 * Token detail's private half, twin of the iOS `TokenPrivacySection`: the "Private balance" line
 * (amount, Try again, or "Register to start shielding") and the core's action. Fund with STRK
 * opens Receive; Deploy and enable and Go private open the journey; Shield and Unshield stay
 * disabled while the core's capabilities say mobile cannot submit them.
 */
@Composable
fun TokenPrivacySection(
    store: WalletStore,
    tokenAddress: String,
    receive: () -> Unit,
    journey: () -> Unit,
) {
    val skin = LocalSkin.current
    val detail = store.tokenDetailPrivacyFor(tokenAddress)
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        DetailSummaryLine(store, detail.summary)
        when (detail.action) {
            DetailAction.NONE -> {
                // Nothing to offer for this token here.
            }

            DetailAction.FUND_WITH_STRK -> {
                PillButton(PrivacyCopy.tileFundLabel, icon = BrambleIconName.QR_CODE, onClick = receive)
            }

            DetailAction.DEPLOY_AND_ENABLE -> {
                PillButton(PrivacyCopy.tileDeployLabel, icon = BrambleIconName.SHIELD, onClick = journey)
            }

            DetailAction.GO_PRIVATE -> {
                PillButton(PrivacyCopy.detailGoPrivate, icon = BrambleIconName.SHIELD, onClick = journey)
            }

            DetailAction.SHIELD_UNSHIELD -> {
                val capabilities = privacyCapabilities()
                Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                    // Shielding and unshielding are not built on mobile: the capabilities keep these disabled.
                    PillButton(
                        PrivacyCopy.detailShield,
                        modifier = Modifier.weight(1f),
                        icon = BrambleIconName.SHIELD,
                        enabled = capabilities.canShield,
                    ) {}
                    PillButton(
                        PrivacyCopy.detailUnshield,
                        modifier = Modifier.weight(1f),
                        kind = PillKind.SECONDARY,
                        enabled = capabilities.canUnshield,
                    ) {}
                }
                Text(PrivacyCopy.unsupportedTitle, color = skin.muted, style = textStyle(BrambleTypeScale.label))
            }
        }
    }
}

/** The summary line; Try again re-reads the private balances. */
@Composable
private fun DetailSummaryLine(
    store: WalletStore,
    summary: DetailSummary,
) {
    val scope = rememberCoroutineScope()
    when (summary) {
        is DetailSummary.None -> {
            // No private line for this token yet.
        }

        is DetailSummary.Retry -> {
            PrivateBalanceLine(
                PrivacyCopy.retry,
                muted = true,
                Modifier.clickable(role = Role.Button) { scope.launch { store.refreshPrivacy() } },
            )
        }

        is DetailSummary.RegisterToStart -> {
            PrivateBalanceLine(PrivacyCopy.registerToStart, muted = true)
        }

        is DetailSummary.Amount -> {
            PrivateBalanceLine(summary.text, muted = false)
        }
    }
}

/** The lock glyph, "Private balance" and the value, read as one element. */
@Composable
private fun PrivateBalanceLine(
    value: String,
    muted: Boolean,
    modifier: Modifier = Modifier,
) {
    val skin = LocalSkin.current
    Row(
        modifier.fillMaxWidth().heightIn(min = BrambleControl.hit).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrambleIcon(BrambleIconName.LOCK, skin.muted, BrambleLayout.detailIcon)
        Text(
            PrivacyCopy.privateBalance,
            color = skin.muted,
            style = textStyle(BrambleTypeScale.body),
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            color = if (muted) skin.muted else skin.text,
            style = textStyle(BrambleTypeScale.body, if (muted) BrambleWeight.regular else BrambleWeight.bold),
        )
    }
}
