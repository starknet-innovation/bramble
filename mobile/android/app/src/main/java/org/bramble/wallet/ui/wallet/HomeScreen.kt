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
 * major actions (Send opens `SendScreen` for an OpenZeppelin account only), the token list. Mobile has no price source yet, so the total and fiat column read
 * "—", the side panel's prices-unavailable state (the `portfolio-activity` workstream fills them).
 */
@Composable
fun HomeScreen(store: WalletStore, receive: () -> Unit, send: () -> Unit) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xl)) {
        Text(
            "—",
            color = skin.text,
            textAlign = TextAlign.Center,
            style = textStyle(BrambleTypeScale.portfolio, BrambleWeight.heavy, BrambleTracking.amount),
            modifier = Modifier.fillMaxWidth().padding(top = BrambleSpace.md)
                .clearAndSetSemantics { contentDescription = "Portfolio total unavailable" },
        )
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
            Column {
                store.networkInfo.tokens.forEachIndexed { offset, token ->
                    if (offset > 0) Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
                    TokenRow(token, store.amount(token))
                }
            }
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

/** `.token-row`: logo, symbol over amount (tabular digits), fiat value on the right. */
@Composable
private fun TokenRow(token: TokenInfo, amount: String?) {
    val skin = LocalSkin.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = BrambleSize.rowCompact).padding(horizontal = BrambleSpace.sm, vertical = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TokenMark(token.address, token.symbol)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(token.symbol, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text(amount ?: "…", color = skin.muted, style = textStyle(BrambleTypeScale.body).copy(fontFeatureSettings = "tnum"))
        }
        Text("—", color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.bold))
    }
}

/** Activity dock screen: no history yet, so the side panel's empty copy (for `portfolio-activity`). */
@Composable
fun ActivityScreen() {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Text("Activity", color = skin.text, style = textStyle(BrambleTypeScale.title, BrambleWeight.bold))
        Text(
            "No activity yet. On-chain transactions for this account, and transactions you submit from this wallet, appear here.",
            color = skin.muted,
            textAlign = TextAlign.Center,
            style = textStyle(BrambleTypeScale.label),
            modifier = Modifier.fillMaxWidth().padding(vertical = BrambleSpace.lg, horizontal = BrambleSpace.md),
        )
    }
}
