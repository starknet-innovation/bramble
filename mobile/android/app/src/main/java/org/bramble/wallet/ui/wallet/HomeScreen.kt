package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import org.bramble.core.TokenInfo
import org.bramble.wallet.WalletStore
import org.bramble.wallet.sendRefusal
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTracking
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle

/**
 * `homeView()` from `portfolio/home-view.ts`, port of the iOS `HomeView`: hero total, the four
 * major actions (Send opens `SendScreen` for an OpenZeppelin account only), and the token list,
 * all from the portfolio store (prices, tracked tokens, the one balance read).
 */
@Composable
fun HomeScreen(store: WalletStore, receive: () -> Unit, send: () -> Unit) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xl)) {
        org.bramble.wallet.portfolio.PortfolioHeroSection(store.portfolio)
        Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
            val active = store.activeRecord
            ActionTile("Send", BrambleIconName.SEND, enabled = active != null, modifier = Modifier.weight(1f)) {
                // Braavos (view only) and Ready accounts never open the send flow; the core would refuse them.
                val refusal = active?.let(::sendRefusal)
                if (refusal != null) store.showToast(refusal) else send()
            }
            ActionTile("Swap", BrambleIconName.SHUFFLE, enabled = false, modifier = Modifier.weight(1f)) {}
            ActionTile("Receive", BrambleIconName.QR_CODE, modifier = Modifier.weight(1f), onClick = receive)
            ActionTile("Shield", BrambleIconName.SHIELD, enabled = false, modifier = Modifier.weight(1f)) {}
        }
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Tokens", color = skin.text, style = textStyle(BrambleTypeScale.title, BrambleWeight.bold), modifier = Modifier.weight(1f))
                Box(Modifier.size(BrambleControl.hit), contentAlignment = Alignment.Center) {
                    BrambleIcon(BrambleIconName.MORE_HORIZONTAL, skin.muted)
                }
            }
            org.bramble.wallet.portfolio.PortfolioTokenList(store.portfolio)
        }
    }
}

/** `.action-tile`: accent-soft ground, 22.5dp icon over a caption label. */
@Composable
private fun ActionTile(title: String, icon: BrambleIconName, modifier: Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Column(
        modifier.alpha(if (enabled) 1f else 0.4f)
            .fillPress(skin.accentSoft, skin.accentSoft.copy(alpha = 0.8f), RoundedCornerShape(BrambleRadius.lg), pressedScale = 0.97f, enabled = enabled, onClick = onClick)
            .heightIn(min = BrambleSize.actionTile),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs, Alignment.CenterVertically),
    ) {
        BrambleIcon(icon, skin.accent, BrambleControl.majorIcon)
        Text(title, color = skin.accent, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
    }
}

/** Activity dock screen: the account's one activity list, read when due and while visible. */
@Composable
fun ActivityScreen(store: WalletStore) {
    val skin = LocalSkin.current
    androidx.compose.runtime.LaunchedEffect(store.portfolio.scope?.accountId) {
        store.portfolio.refreshActivity(force = false)
    }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Text("Activity", color = skin.text, style = textStyle(BrambleTypeScale.title, BrambleWeight.bold))
        org.bramble.wallet.portfolio.PortfolioActivity(store.portfolio)
    }
}
