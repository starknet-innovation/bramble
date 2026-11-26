package org.bramble.wallet.coordination

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.launch
import org.bramble.core.CoreException
import org.bramble.core.IntentState
import org.bramble.core.MultisigIntent
import org.bramble.core.MultisigRecord
import org.bramble.core.TokenInfo
import org.bramble.core.explorerAccountUrl
import org.bramble.core.formatTokenAmount
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SegmentedControl
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.design.weight
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.QrCode
import org.bramble.wallet.ui.wallet.QrCard

private const val AUTHORITY_UNVERIFIED =
    "Deployment and signer authority could not be verified. Retry when network access is restored."

private const val WATCH_ONLY =
    "This wallet does not own a current signer, so it can watch this account but cannot propose actions."

/** Fraction digits shown for a shared balance. */
private const val BALANCE_FRACTION_DIGITS: UByte = 4u

/** The two sections of a shared account's home. */
internal enum class SharedTab { TOKENS, INTENTS }

/**
 * `multisig-home`, port of the iOS `SharedAccountHomeView`: the shared account's actions and
 * notes, then Tokens and Transactions. Transactions lists the open signing intents and imports one;
 * "Co-signer updates" syncs gift wraps, whose trusted packages are still held, not imported
 * (docs/multisig-transactions.md). [tabState] is the stack entry's, so it outlives a push; [open]
 * pushes Send, Signers, Deploy, Receive and each intent.
 */
@Composable
internal fun SharedAccountHomeScreen(
    store: WalletStore,
    id: String,
    tabState: MutableState<SharedTab>,
    open: (MultisigFlow) -> Unit,
    back: () -> Unit,
) {
    val record = store.coordination.multisigs.firstOrNull { it.id == id }
    if (record == null) {
        Page(store, "Ready multisig", null, back) { Caption("This Ready multisig is no longer watched.") }
        return
    }
    var tab by tabState
    // Raw balances by symbol; null until a read succeeds, and after one fails.
    var balances by remember { mutableStateOf<Map<String, String>?>(null) }
    LaunchedEffect(record.address) {
        balances = runCatching { store.rpc.balances(record.address, store.networkInfo) }.getOrNull()
    }
    Page(store, multisigDisplayName(record), multisigConfigLabel(record), back) {
        Actions(store, record, open)
        SegmentedControl(
            listOf("Tokens" to SharedTab.TOKENS, MultisigTxText.TRANSACTIONS to SharedTab.INTENTS),
            tab,
        ) { tab = it }
        if (tab == SharedTab.TOKENS) SharedTokens(store.networkInfo.tokens, balances) else Intents(store, record, open)
        StopWatching(store, record, back)
    }
}

@Composable
private fun Actions(
    store: WalletStore,
    record: MultisigRecord,
    open: (MultisigFlow) -> Unit,
) {
    val skin = LocalSkin.current
    val context = LocalContext.current
    val undeployed = record.deployment != null && !record.hasCurrentConfig
    if (record.hasCurrentConfig && record.localSignerAccountIds.isNotEmpty()) {
        Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            PillButton(MultisigTxText.SEND, Modifier.weight(1f), PillKind.SECONDARY, BrambleIconName.SEND) {
                open(MultisigFlow.Propose(record.id))
            }
            PillButton(MultisigTxText.SIGNERS, Modifier.weight(1f), PillKind.SECONDARY, BrambleIconName.USERS) {
                open(MultisigFlow.Signers(record.id))
            }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm), verticalAlignment = Alignment.CenterVertically) {
        if (undeployed) {
            PillButton("Deploy", Modifier.weight(1f), PillKind.SECONDARY, BrambleIconName.WALLET) {
                open(MultisigFlow.Create(record.id))
            }
        }
        PillButton("Receive", Modifier.weight(1f), PillKind.SECONDARY, BrambleIconName.QR_CODE) {
            open(MultisigFlow.Receive(record.id))
        }
        val explorer = explorerAccountUrl(store.network, record.address)
        IconButton(BrambleIconName.EXTERNAL_LINK, "Open in explorer", tint = skin.muted, enabled = explorer != null) {
            explorer?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) }
        }
    }
    val bold = SpanStyle(fontWeight = weight(BrambleWeight.bold))
    val note =
        when {
            undeployed -> {
                buildAnnotatedString {
                    withStyle(bold) { append("Deployment required. ") }
                    append("Continue the saved setup before sending.")
                }
            }

            record.threshold == null -> {
                buildAnnotatedString { append(AUTHORITY_UNVERIFIED) }
            }

            record.localSignerAccountIds.isEmpty() -> {
                buildAnnotatedString { append(WATCH_ONLY) }
            }

            !record.hasCurrentConfig -> {
                buildAnnotatedString {
                    withStyle(bold) { append("Signer found. ") }
                    append("Add the remaining public signer keys before sending.")
                }
            }

            else -> {
                null
            }
        }
    note?.let { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption)) }
}

/** The network's tokens with the shared account's balances, or the unavailable line. */
@Composable
private fun SharedTokens(
    tokens: List<TokenInfo>,
    balances: Map<String, String>?,
) {
    val skin = LocalSkin.current
    if (balances == null) return Caption("Shared balances are unavailable right now.")
    MenuGroup {
        tokens.forEachIndexed { index, token ->
            if (index > 0) MenuDivider()
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = BrambleSize.row)
                    .padding(horizontal = BrambleSpace.lg),
                horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TokenMark(token.address, token.symbol)
                Text(
                    token.name,
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.row, BrambleWeight.medium),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    balanceLabel(balances[token.symbol], token),
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
                )
            }
        }
    }
}

/** The formatted balance with its symbol, or a dash when the read has no usable amount. */
private fun balanceLabel(
    raw: String?,
    token: TokenInfo,
): String =
    raw
        ?.let { runCatching { formatTokenAmount(it, token.decimals, BALANCE_FRACTION_DIGITS) }.getOrNull() }
        ?.let { "$it ${token.symbol}" } ?: "—"

/** Transactions: "Co-signer updates" and its sync, the open intents, and Import transaction. */
@Composable
private fun Intents(
    store: WalletStore,
    record: MultisigRecord,
    open: (MultisigFlow) -> Unit,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var result by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var syncing by remember { mutableStateOf(false) }
    // Null until read, so the empty line never shows ahead of the list.
    var intents by remember { mutableStateOf<List<MultisigIntent>?>(null) }
    // Keyed on the open count too, so a signature or submission made one screen deeper shows here.
    LaunchedEffect(record.id, store.coordination.openIntents[record.id]) {
        intents = store.coordination.intents(record.id).filter(::isOpen)
    }
    Column(
        Modifier
            .fillMaxWidth()
            .background(skin.panel, RoundedCornerShape(BrambleRadius.lg))
            .padding(BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        Text("Co-signer updates", color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.bold))
        Caption("Check securely for intents and signatures shared by known contacts.")
        PillButton("Check for updates", kind = PillKind.SECONDARY, icon = BrambleIconName.REFRESH, busy = syncing) {
            scope.launch {
                syncing = true
                val outcome = runCatching { store.coordination.sync(record.id) }
                syncing = false
                failed = outcome.isFailure
                result = syncMessage(outcome)
            }
        }
        StatusLine(result, if (failed) StatusTone.DANGER else StatusTone.MUTED)
        val listed = intents
        if (listed?.isEmpty() == true) {
            Text(MultisigTxText.NOTHING_IMPORT, color = skin.muted, style = textStyle(BrambleTypeScale.body))
        } else if (listed != null) {
            Eyebrow(intentsHeading(listed))
            MenuGroup {
                listed.forEachIndexed { index, intent ->
                    if (index > 0) MenuDivider()
                    MenuRow(BrambleIconName.USERS, intent.summary, value = MultisigTxText.status(intent)) {
                        open(MultisigFlow.Intent(record.id, intent.id))
                    }
                }
            }
        }
        PillButton(MultisigTxText.IMPORT_TRANSACTION, kind = PillKind.GHOST, icon = BrambleIconName.CHEVRON_RIGHT) {
            open(MultisigFlow.Import(record.id))
        }
    }
}

/** `compactIntentList`'s heading: all stale, some stale, or all awaiting. */
private fun intentsHeading(intents: List<MultisigIntent>): String =
    when {
        intents.all { it.state == IntentState.STALE } -> MultisigTxText.ATTENTION
        intents.any { it.state == IntentState.STALE } -> MultisigTxText.NEEDING_YOU
        else -> MultisigTxText.WAITING
    }

/** The status copy for one "Check for updates" (iOS `sync`). */
private fun syncMessage(outcome: Result<org.bramble.core.CoordinationSyncOutcome>): String =
    outcome.fold(
        {
            if (it.held == 0u) {
                "No new co-signer updates"
            } else {
                "${it.held} co-signer update${if (it.held == 1u) "" else "s"} received. " +
                    "Open them after the next Bramble update."
            }
        },
        {
            when (it) {
                is CoreException.Locked -> "The wallet is locked"
                is CoreException.Coordination -> "Secure co-signer updates are unavailable. Try again shortly"
                else -> "Secure co-signer updates could not be verified. Try again shortly"
            }
        },
    )

/** "Stop watching", confirmed in place (iOS's confirmation dialog) before the record is removed. */
@Composable
private fun StopWatching(
    store: WalletStore,
    record: MultisigRecord,
    back: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var confirming by remember { mutableStateOf(false) }
    Column(Modifier.padding(top = BrambleSpace.md), verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Caption("Removing stops local tracking only. It never changes the on-chain account.")
        if (!confirming) {
            PillButton("Stop watching", kind = PillKind.GHOST) { confirming = true }
        } else {
            RowTitle("Stop watching this shared account?")
            PillButton("Stop watching", kind = PillKind.DANGER) {
                scope.launch {
                    runCatching { store.coordination.removeShared(record.id) }.onFailure(store::showError)
                    back()
                }
            }
            PillButton("Cancel", kind = PillKind.GHOST) { confirming = false }
        }
    }
}

/** `multisig-receive`: the shared address only; a multisig has no contact card or identity. */
@Composable
internal fun SharedReceiveScreen(
    store: WalletStore,
    id: String,
    back: () -> Unit,
) {
    val record = store.coordination.multisigs.firstOrNull { it.id == id }
    Page(store, "Receive", record?.let(::multisigDisplayName), back) {
        if (record != null) FundingAddress(store, record.address, "Copy address", "QR code of the address")
        Caption("Send only Starknet assets on ${store.networkInfo.name}.")
    }
}

/** A shared address as a QR card spoken as [qrLabel], the short address, and its copy control. */
@Composable
internal fun FundingAddress(
    store: WalletStore,
    address: String,
    copyLabel: String,
    qrLabel: String,
) {
    val skin = LocalSkin.current
    val matrix = remember(address) { QrCode.matrix(address) }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) { QrCard(matrix, qrLabel) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            org.bramble.wallet.ui
                .shortAddress(address),
            color = skin.text,
            style = textStyle(BrambleTypeScale.body, mono = true),
            modifier = Modifier.weight(1f),
        )
        CopyButton(store, address, copyLabel)
    }
}
