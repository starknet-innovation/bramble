package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.send.DeployNoticeChip
import org.bramble.wallet.sendRefusal
import org.bramble.wallet.strkFunded

/**
 * `homeView()` from `portfolio/home-view.ts`, port of the iOS `HomeView`: hero total, the deploy
 * notice, the four major actions (Send opens `SendScreen` for an OpenZeppelin account only), and
 * the token list, all from the portfolio store (prices, tracked tokens, the one balance read). The
 * deploy notice and the Shield gate take the core's judgement of the account's deployment.
 */
@Composable
fun HomeScreen(
    store: WalletStore,
    actions: HomeActions,
) {
    val skin = LocalSkin.current
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xl)) {
        org.bramble.wallet.portfolio
            .PortfolioHeroSection(store.portfolio)
        DeployNoticeChip(store, receive = actions.receive, deploy = actions.deploy)
        Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
            val active = store.activeRecord
            ActionTile("Send", BrambleIconName.SEND, enabled = active != null, modifier = Modifier.weight(1f)) {
                // Braavos (view only) and Ready accounts never open the send flow; the core would refuse them.
                val refusal = active?.let(::sendRefusal)
                if (refusal != null) store.showToast(refusal) else actions.send()
            }
            ActionTile("Swap", BrambleIconName.SHUFFLE, enabled = false, modifier = Modifier.weight(1f)) {}
            ActionTile("Receive", BrambleIconName.QR_CODE, modifier = Modifier.weight(1f), onClick = actions.receive)
            org.bramble.wallet.privacy.ShieldActionTile(
                org.bramble.core.shieldTile(
                    store.network,
                    store.deployment,
                    store.strkFunded,
                    store.privacy.reading,
                ),
                modifier = Modifier.weight(1f),
                receive = actions.receive,
                journey = actions.privacy,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Tokens",
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.title, BrambleWeight.bold),
                    modifier = Modifier.weight(1f),
                )
                Box(Modifier.size(BrambleControl.hit), contentAlignment = Alignment.Center) {
                    BrambleIcon(BrambleIconName.MORE_HORIZONTAL, skin.muted)
                }
            }
            org.bramble.wallet.portfolio
                .PortfolioTokenList(store.portfolio, open = actions.openToken)
        }
    }
}

/**
 * Where Home's controls lead, wired by the shell: the flows it pushes and a token's detail by id.
 *
 * @property receive opens Receive (also the Fund with STRK notice and Shield tile).
 * @property send opens the Send journey (OpenZeppelin accounts only).
 * @property deploy opens the Deploy account flow from the deploy notice.
 * @property privacy opens the privacy journey.
 * @property openToken opens a tracked token's detail by its token id.
 */
data class HomeActions(
    val receive: () -> Unit,
    val send: () -> Unit,
    val deploy: () -> Unit,
    val privacy: () -> Unit,
    val openToken: (String) -> Unit,
)

/** A disabled action tile's opacity. */
private const val DISABLED_TILE_ALPHA = 0.4f

/** `.action-tile`: accent-soft ground, 22.5dp icon over a caption label. */
@Composable
internal fun ActionTile(
    title: String,
    icon: BrambleIconName,
    modifier: Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Column(
        modifier
            .alpha(if (enabled) 1f else DISABLED_TILE_ALPHA)
            .fillPress(
                skin.accentSoft,
                skin.accentSoft.copy(alpha = 0.8f),
                RoundedCornerShape(BrambleRadius.lg),
                pressedScale = 0.97f,
                enabled = enabled,
                onClick = onClick,
            ).heightIn(min = BrambleSize.actionTile),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs, Alignment.CenterVertically),
    ) {
        BrambleIcon(icon, skin.accent, BrambleControl.majorIcon)
        Text(title, color = skin.accent, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
    }
}
