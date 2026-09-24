package org.bramble.wallet.ui.wallet

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.launch
import org.bramble.core.explorerAccountUrl
import org.bramble.wallet.Tab
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.AccountAvatar
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.StatusDot
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.send.SendScreen

/** Screens pushed over the shell, without the dock. */
enum class Flow { RECEIVE, SEND, MANAGE_ACCOUNTS, NETWORK, APPEARANCE, SECURITY, REVEAL, REMOVE }

/**
 * The wallet frame from `wallet-shell.ts` / `styles-dock.ts`, port of the iOS `WalletShell`:
 * persistent account header, the active dock screen with pull-to-refresh, and the floating dock.
 * Flow screens replace it (the system back gesture pops them); the accounts sheet opens over it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletShell(store: WalletStore) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var flows by remember { mutableStateOf(listOf<Flow>()) }
    var accountsOpen by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val pop = { flows = flows.dropLast(1) }
    BackHandler(enabled = flows.isNotEmpty()) { pop() }

    val flow = flows.lastOrNull()
    if (flow != null) {
        Box(Modifier.fillMaxSize().background(skin.bg).safeDrawingPadding()) {
            when (flow) {
                Flow.RECEIVE -> ReceiveScreen(store, back = pop)
                Flow.SEND -> SendScreen(store, back = pop)
                Flow.MANAGE_ACCOUNTS -> ManageAccountsScreen(store, back = pop)
                Flow.NETWORK -> NetworkScreen(store, back = pop)
                Flow.APPEARANCE -> AppearanceScreen(store, back = pop)
                Flow.SECURITY -> SecurityScreen(store, back = pop)
                Flow.REVEAL -> RevealScreen(store, back = pop)
                Flow.REMOVE -> RemoveWalletScreen(store, back = pop)
            }
        }
        return
    }

    val refreshState = rememberPullToRefreshState()
    Box(Modifier.fillMaxSize().background(skin.bg)) {
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    store.refreshBalances()
                    refreshing = false
                }
            },
            state = refreshState,
            modifier = Modifier.fillMaxSize().safeDrawingPadding(),
            indicator = {
                PullToRefreshDefaults.Indicator(
                    state = refreshState,
                    isRefreshing = refreshing,
                    containerColor = skin.panel,
                    color = skin.text,
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            },
        ) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
                verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
            ) {
                WalletHeader(store, openAccounts = { accountsOpen = true })
                when (store.tab) {
                    Tab.HOME -> HomeScreen(store, receive = { flows = flows + Flow.RECEIVE }, send = { flows = flows + Flow.SEND })
                    Tab.ACTIVITY -> ActivityScreen()
                    Tab.SETTINGS -> SettingsHubScreen(store, open = { flows = flows + it })
                }
                // Clearance for the floating dock: item, its padding, and the gap above the inset.
                Spacer(Modifier.height(BrambleControl.dockItem + BrambleSpace.md + BrambleSpace.lg + BrambleSpace.lg))
            }
        }
        FloatingDock(
            tab = store.tab,
            onSelect = { store.tab = it },
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = BrambleSpace.lg),
        )
    }
    if (accountsOpen) {
        AccountsSheet(store, onDismiss = { accountsOpen = false }, openManage = { flows = flows + Flow.MANAGE_ACCOUNTS })
    }
}

/**
 * `.wallet-header` (`docs/accounts.md` §2.1): avatar, the core's display name with the drawer
 * chevron, network status, actions. No address and no copy here, as in the extension.
 */
@Composable
private fun WalletHeader(store: WalletStore, openAccounts: () -> Unit) {
    val skin = LocalSkin.current
    val context = LocalContext.current
    val account = store.activeRecord
    val explorer = account?.let { explorerAccountUrl(store.network, it.address) }
    Row(
        Modifier.fillMaxWidth().padding(top = BrambleSpace.sm),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f)
                .semantics(mergeDescendants = true) {
                    contentDescription = "Accounts"
                    role = Role.Button
                }
                .clickable(onClick = openAccounts),
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccountAvatar(account?.address ?: "0x0")
            Column(verticalArrangement = Arrangement.spacedBy(BrambleLayout.subtitleGap)) {
                Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        account?.displayName.orEmpty(),
                        color = skin.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = textStyle(BrambleTypeScale.body, BrambleWeight.bold),
                    )
                    BrambleIcon(BrambleIconName.CHEVRON_DOWN, skin.muted, BrambleLayout.accountChevron)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(BrambleLayout.pillGap), verticalAlignment = Alignment.CenterVertically) {
                    StatusDot(store.networkHealthy)
                    Text(store.networkLabel, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            IconButton(
                BrambleIconName.EXTERNAL_LINK,
                if (explorer != null) "Open in explorer" else "Explorer unavailable on this network",
                tint = skin.muted,
                enabled = explorer != null,
            ) {
                if (explorer != null) {
                    try {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(explorer)))
                    } catch (ignored: ActivityNotFoundException) {
                        store.showToast("No app can open the explorer link")
                    }
                }
            }
            IconButton(BrambleIconName.LOCK, "Lock wallet", tint = skin.muted) { store.lock() }
        }
    }
}
