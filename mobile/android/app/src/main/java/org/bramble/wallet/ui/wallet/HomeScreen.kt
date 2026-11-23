package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import kotlinx.coroutines.launch
import org.bramble.wallet.Tab
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.strkFunded

/**
 * `homeView()` from `portfolio/home-view.ts`, port of the iOS `HomeView`: hero total, the four
 * major actions (Send opens `SendScreen` for an OpenZeppelin account only), and the token list,
 * all from the portfolio store (prices, tracked tokens, the one balance read). Home no longer
 * flags an undeployed account: the first send deploys it, and Settings' "This account" offers the
 * Deploy account screen. The Shield gate takes the core's judgement of the account's deployment.
 */
@Composable
fun HomeScreen(
    store: WalletStore,
    actions: HomeActions,
) {
    val skin = LocalSkin.current
    var menuOpen by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xl)) {
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            org.bramble.wallet.portfolio
                .PortfolioHeroSection(store.portfolio)
            org.bramble.wallet.privacy
                .ShieldedHeroLabel(store)
            ReadyKeyNoticeCard(store, moveFunds = actions.send)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
            val active = store.activeRecord
            ActionTile("Send", BrambleIconName.SEND, enabled = active != null, modifier = Modifier.weight(1f)) {
                actions.send()
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
                IconButton(
                    BrambleIconName.MORE_HORIZONTAL,
                    "Portfolio actions",
                    tint = skin.muted,
                ) { menuOpen = !menuOpen }
            }
            if (menuOpen) {
                PortfolioMenu(store, actions.manageTokens) { menuOpen = false }
            }
            org.bramble.wallet.portfolio
                .PortfolioTokenList(store.portfolio, open = actions.openToken, manage = actions.manageTokens) {
                    org.bramble.wallet.privacy
                        .PrivacyRetryRow(store)
                }
        }
    }
}

/**
 * Where Home's controls lead, wired by the shell: the flows it pushes and a token's detail by id.
 *
 * @property receive opens Receive.
 * @property send opens the Send journey (OpenZeppelin accounts only).
 * @property privacy opens the privacy journey (every enabled Shield tile).
 * @property openToken opens a tracked token's detail by its token id.
 * @property manageTokens opens the token list (Manage tokens).
 */
data class HomeActions(
    val receive: () -> Unit,
    val send: () -> Unit,
    val privacy: () -> Unit,
    val openToken: (String) -> Unit,
    val manageTokens: () -> Unit,
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

/**
 * The Tokens heading's overflow (iOS `PortfolioHome.header` menu): manage, settings, refresh. It
 * opens in place under the heading rather than in a popup window, which `FLAG_SECURE` may not
 * cover (`SourceHygieneTest`); [close] folds it after any action, as iOS's menu does.
 */
@Composable
private fun PortfolioMenu(
    store: WalletStore,
    manageTokens: () -> Unit,
    close: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    MenuGroup {
        MenuRow(BrambleIconName.COINS, "Manage tokens") {
            close()
            manageTokens()
        }
        MenuDivider()
        MenuRow(BrambleIconName.SETTINGS, "Wallet settings") {
            close()
            store.tab = Tab.SETTINGS
        }
        MenuDivider()
        MenuRow(BrambleIconName.REFRESH, "Refresh portfolio", chevron = false) {
            close()
            scope.launch { store.portfolio.refresh(force = true) }
        }
    }
}
