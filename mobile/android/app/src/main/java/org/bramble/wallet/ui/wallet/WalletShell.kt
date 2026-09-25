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
import org.bramble.wallet.refreshBalances
import org.bramble.wallet.send.SendScreen

/**
 * The wallet frame from `wallet-shell.ts` / `styles-dock.ts`, port of the iOS `WalletShell`:
 * persistent account header, the active dock screen with pull-to-refresh, and the floating dock.
 * Flow screens replace it (the system back gesture pops them); the accounts sheet opens over it.
 */
@Composable
fun WalletShell(store: WalletStore) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var flows by remember { mutableStateOf(listOf<Flow>()) }
    var accountsOpen by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    // The token a pushed Flow.TOKEN_DETAIL shows (the flow stack holds screens, not arguments).
    var tokenId by remember { mutableStateOf("") }
    val pop = { flows = flows.dropLast(1) }
    val push = { next: Flow -> flows = flows + next }
    BackHandler(enabled = flows.isNotEmpty()) { pop() }

    val flow = flows.lastOrNull()
    if (flow != null) {
        Box(Modifier.fillMaxSize().background(skin.bg).safeDrawingPadding()) {
            FlowScreen(flow, store, tokenId, pop, push)
        }
        return
    }

    DockFrame(
        store = store,
        refreshing = refreshing,
        refresh = {
            scope.launch {
                refreshing = true
                store.refreshBalances()
                refreshing = false
            }
        },
    ) {
        WalletHeader(store, openAccounts = { accountsOpen = true })
        DockScreen(store, push) { id ->
            tokenId = id
            push(Flow.TOKEN_DETAIL)
        }
    }
    if (accountsOpen) {
        AccountsSheet(
            store,
            onDismiss = { accountsOpen = false },
            openManage = { push(Flow.MANAGE_ACCOUNTS) },
            openMultisig = { push(Flow.READY_MULTISIG) },
        )
    }
}

/**
 * The pushed [flow]'s screen; [pop] returns to the one below it, [push] opens another. [tokenId]
 * is the tracked token a [Flow.TOKEN_DETAIL] shows.
 */
@Composable
private fun FlowScreen(
    flow: Flow,
    store: WalletStore,
    tokenId: String,
    pop: () -> Unit,
    push: (Flow) -> Unit,
) {
    when (flow) {
        Flow.RECEIVE -> {
            ReceiveScreen(store, back = pop, openPrivacy = { push(Flow.PRIVACY) })
        }

        Flow.SEND -> {
            SendScreen(store, back = pop)
        }

        Flow.MANAGE_ACCOUNTS -> {
            ManageAccountsScreen(store, back = pop)
        }

        Flow.NETWORK -> {
            NetworkScreen(store, back = pop)
        }

        Flow.APPEARANCE -> {
            AppearanceScreen(store, back = pop)
        }

        Flow.SECURITY -> {
            SecurityScreen(store, back = pop)
        }

        Flow.REVEAL -> {
            RevealScreen(store, back = pop)
        }

        Flow.REMOVE -> {
            RemoveWalletScreen(store, back = pop)
        }

        Flow.ADDRESS_BOOK -> {
            org.bramble.wallet.coordination
                .AddressBookScreen(store, back = pop)
        }

        Flow.SHARED_ACCOUNTS -> {
            org.bramble.wallet.coordination
                .SharedAccountsScreen(store, back = pop)
        }

        Flow.READY_MULTISIG -> {
            org.bramble.wallet.coordination
                .ReadyMultisigScreen(store, back = pop)
        }

        Flow.PRIVACY, Flow.DEPLOY, Flow.TOKEN_DETAIL -> {
            PortfolioFlowScreen(flow, store, tokenId, pop, push)
        }
    }
}

/** The flows that act on the active account's portfolio: privacy, deployment, token detail. */
@Composable
private fun PortfolioFlowScreen(
    flow: Flow,
    store: WalletStore,
    tokenId: String,
    pop: () -> Unit,
    push: (Flow) -> Unit,
) {
    when (flow) {
        Flow.DEPLOY -> {
            org.bramble.wallet.send
                .DeployAccountScreen(store, back = pop)
        }

        Flow.TOKEN_DETAIL -> {
            org.bramble.wallet.portfolio.TokenDetailScreen(
                store,
                tokenId,
                back = pop,
                receive = { push(Flow.RECEIVE) },
                journey = { push(Flow.PRIVACY) },
            )
        }

        else -> {
            org.bramble.wallet.privacy
                .PrivacyJourneyScreen(store, chooseNetwork = { push(Flow.NETWORK) }, back = pop)
        }
    }
}

/** The dock screen for the selected tab; [openToken] opens a tracked token's detail by id. */
@Composable
private fun DockScreen(
    store: WalletStore,
    push: (Flow) -> Unit,
    openToken: (String) -> Unit,
) {
    when (store.tab) {
        Tab.HOME -> {
            HomeScreen(
                store,
                HomeActions(
                    receive = { push(Flow.RECEIVE) },
                    send = { push(Flow.SEND) },
                    deploy = { push(Flow.DEPLOY) },
                    privacy = { push(Flow.PRIVACY) },
                    openToken = openToken,
                ),
            )
        }

        Tab.ACTIVITY -> {
            ActivityScreen(store)
        }

        Tab.SETTINGS -> {
            SettingsHubScreen(store, open = push)
        }
    }
}

/** The pull-to-refresh scroll column over which the floating dock sits; [content] fills the column. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DockFrame(
    store: WalletStore,
    refreshing: Boolean,
    refresh: () -> Unit,
    content: @Composable () -> Unit,
) {
    val skin = LocalSkin.current
    val refreshState = rememberPullToRefreshState()
    Box(Modifier.fillMaxSize().background(skin.bg)) {
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = refresh,
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
                content()
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
}

/**
 * `.wallet-header` (`docs/accounts.md` §2.1): avatar, the core's display name with the drawer
 * chevron, network status, actions. No address and no copy here, as in the extension.
 */
@Composable
private fun WalletHeader(
    store: WalletStore,
    openAccounts: () -> Unit,
) {
    val skin = LocalSkin.current
    val account = store.activeRecord
    val explorer = account?.let { explorerAccountUrl(store.network, it.address) }
    Row(
        Modifier.fillMaxWidth().padding(top = BrambleSpace.sm),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .weight(1f)
                .semantics(mergeDescendants = true) {
                    contentDescription = "Accounts"
                    role = Role.Button
                }.clickable(onClick = openAccounts),
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccountAvatar(account?.address ?: "0x0")
            Column(verticalArrangement = Arrangement.spacedBy(BrambleLayout.subtitleGap)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        account?.displayName.orEmpty(),
                        color = skin.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = textStyle(BrambleTypeScale.body, BrambleWeight.bold),
                    )
                    BrambleIcon(BrambleIconName.CHEVRON_DOWN, skin.muted, BrambleLayout.accountChevron)
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(BrambleLayout.pillGap),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    StatusDot(store.networkHealthy)
                    Text(store.networkLabel, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
                }
            }
        }
        HeaderActions(store, explorer)
    }
}

/** The header's explorer link ([explorer] is null where the network has none) and lock control. */
@Composable
private fun HeaderActions(
    store: WalletStore,
    explorer: String?,
) {
    val skin = LocalSkin.current
    val context = LocalContext.current
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
