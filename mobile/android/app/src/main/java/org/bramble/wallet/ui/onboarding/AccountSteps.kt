package org.bramble.wallet.ui.onboarding

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import org.bramble.core.AccountRecord
import org.bramble.core.NetworkId
import org.bramble.core.accountPreviewLabel
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.AccountAvatar
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleMotion
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleShadow
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.CheckRow
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.brambleShadow
import org.bramble.wallet.design.brambleTween
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.previewAccount

/**
 * `#account-preview` with the Mainnet acknowledgement, port of the iOS `ReviewAccountStep`:
 * confirm the derived public address (the new vault's active record, OpenZeppelin index 0 on this
 * network, shown with the core's 10…8 `accountPreviewLabel`), then add it. Create path only; an
 * import goes to "Find your accounts". The card starts selected.
 */
@Composable
fun ReviewAccountStep(store: WalletStore, network: NetworkId, next: () -> Unit) {
    val skin = LocalSkin.current
    var account by remember { mutableStateOf<AccountRecord?>(null) }
    var selected by remember { mutableStateOf(true) }
    var acknowledged by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { account = runCatching { store.previewAccount() }.getOrNull() }
    val cardShape = RoundedCornerShape(BrambleRadius.lg)
    val checkScale by animateFloatAsState(if (selected) 1f else 0.92f, brambleTween(BrambleMotion.pressMs), label = "check")
    OnboardingStep(
        back = null,
        icon = BrambleIconName.WALLET,
        title = "Review your account",
        lede = "Confirm the derived public address, then add it to this wallet.",
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
                Row(
                    Modifier.fillMaxWidth()
                        .semantics(mergeDescendants = true) { this.selected = selected }
                        .then(if (selected) Modifier.brambleShadow(BrambleShadow.sm, cardShape) else Modifier)
                        .fillPress(if (selected) skin.softPress else skin.elevated, skin.softPress, cardShape, role = Role.Checkbox) { selected = !selected }
                        .heightIn(min = BrambleLayout.reviewCardMin)
                        .padding(BrambleSpace.md),
                    horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val address = account?.address
                    if (address != null) {
                        AccountAvatar(address, BrambleSize.mark)
                    } else {
                        Box(Modifier.size(BrambleSize.mark).background(skin.panel, CircleShape))
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                        Text("Primary Bramble account", color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
                        Text(
                            address?.let(::accountPreviewLabel) ?: "Deriving account…",
                            color = skin.muted,
                            style = textStyle(BrambleTypeScale.caption, mono = true),
                        )
                    }
                    Box(
                        Modifier.size(BrambleSize.mark)
                            .graphicsLayer {
                                alpha = if (selected) 1f else 0f
                                scaleX = checkScale
                                scaleY = checkScale
                            }
                            .background(skin.text, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        BrambleIcon(BrambleIconName.CHECK, skin.bg, BrambleLayout.reviewCheckIcon)
                    }
                }
                if (network == NetworkId.MAINNET) {
                    CheckRow(
                        "I understand this wallet can hold real funds on Starknet Mainnet.",
                        checked = acknowledged,
                        onCheckedChange = { acknowledged = it },
                    )
                }
            }
        },
        cta = {
            PillButton(
                "Add selected account",
                enabled = account != null && selected && (network != NetworkId.MAINNET || acknowledged),
                onClick = next,
            )
        },
    )
}
