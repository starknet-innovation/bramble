package org.bramble.wallet.portfolio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.launch
import org.bramble.core.TokenBalance
import org.bramble.core.TrackedToken
import org.bramble.core.compactAmount
import org.bramble.core.fiatValueText
import org.bramble.wallet.WalletStore
import org.bramble.wallet.coordination.Caption
import org.bramble.wallet.coordination.Page
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.capsule
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle

/** Opacity of a token row hidden from Home (iOS `TokenListLayout.hiddenRowOpacity`). */
private const val HIDDEN_ROW_ALPHA = 0.6f

/**
 * `tokensFlow` from `token-flows.ts`, port of the iOS `TokensView`: the add and discover tasks,
 * then every token tracked on the active network with Show/Hide, or "Likely spam" in its place.
 * [addToken] and [discoverTokens] push those flows.
 */
@Composable
fun TokensScreen(
    store: WalletStore,
    back: () -> Unit,
    addToken: () -> Unit,
    discoverTokens: () -> Unit,
) {
    val portfolio = store.portfolio
    val tracked = portfolio.tracked
    Page(store, "Tokens", "${tracked.size} tracked", back) {
        MenuGroup {
            MenuRow(BrambleIconName.PLUS, "Add by contract", onClick = addToken)
            MenuDivider()
            MenuRow(BrambleIconName.SEARCH, "Find held tokens", onClick = discoverTokens)
        }
        Eyebrow("Tracked tokens", Modifier.padding(top = BrambleSpace.sm))
        if (tracked.isEmpty()) {
            Caption("No tokens tracked on this network yet.")
        } else {
            Column { tracked.forEach { TrackedRow(store, it) } }
        }
        Caption("Hidden and likely-spam tokens stay off home but remain listed here.")
    }
}

@Composable
private fun TrackedRow(
    store: WalletStore,
    item: TrackedToken,
) {
    val skin = LocalSkin.current
    val portfolio = store.portfolio
    val token = item.token
    val figures =
        portfolio.balance(token)?.let {
            compactAmount(it.formatted, null) to fiatValueText(it.formatted, portfolio.price(token), portfolio.currency)
        }
    TokenRow(
        token.address to token.symbol,
        token.name,
        figures,
        Modifier.testTag("tracked-${token.symbol}").alpha(if (item.hiddenFromHome) HIDDEN_ROW_ALPHA else 1f),
    ) {
        if (item.likelySpam) {
            Text(
                "Likely spam",
                color = skin.warning,
                style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold),
            )
        } else {
            HideToggle(store, item)
        }
    }
}

/** Show or Hide for one tracked token; `tokens-ui.ts` confirms in the positive tone, fails as an error. */
@Composable
private fun HideToggle(
    store: WalletStore,
    item: TrackedToken,
) {
    val hidden = item.hiddenFromHome
    val verb = if (hidden) "Show" else "Hide"
    CapsuleButton(verb, "$verb ${item.token.symbol}") {
        if (store.portfolio.setHidden(item.token.id, !hidden)) {
            store.showNotice(if (hidden) "Token shown" else "Token hidden")
        } else {
            store.showToast("Token update failed")
        }
    }
}

/** `tokenAddFlow`: the contract address, read on chain before anything is saved. */
@Composable
fun AddTokenScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    Page(store, "Add token", "Track a token by its contract", back) {
        BrambleField(
            label = "Contract address",
            placeholder = "0x…",
            value = address,
            onValueChange = { address = it },
            kind = SecretKind.ADDRESS,
            hint = "Name, symbol, and decimals are read from the contract before it is saved.",
        )
        PillButton("Read and add token", icon = BrambleIconName.CHECK, busy = busy, enabled = address.isNotEmpty()) {
            scope.launch {
                busy = true
                result = store.portfolio.addToken(address)
                busy = false
                val failure = result
                if (failure != null) {
                    store.showToast(failure)
                } else {
                    store.showNotice("Token added")
                    back()
                }
            }
        }
        StatusLine(result, StatusTone.DANGER)
    }
}

/** The discover screen's state: the last scan's results and status, and the token being added. */
private class DiscoverState {
    val found = mutableStateListOf<TokenBalance>()
    var scanned by mutableStateOf(false)
    var status by mutableStateOf<String?>(null)
    var failed by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var adding by mutableStateOf<String?>(null)

    /** Scans the registry; a failure is shown as its status and as a toast. */
    suspend fun scan(store: WalletStore) {
        busy = true
        val outcome = store.portfolio.discoverTokens()
        busy = false
        val tokens = outcome.getOrNull()
        failed = tokens == null
        if (tokens != null) {
            found.clear()
            found.addAll(tokens)
            scanned = true
        }
        status = if (tokens == null) outcome.exceptionOrNull()?.message else scanStatus(tokens.size)
        if (tokens == null) store.showToast(status.orEmpty())
    }

    /** Adds a found token; on success it leaves the list. */
    suspend fun add(
        store: WalletStore,
        balance: TokenBalance,
    ) {
        adding = balance.token.id
        val failure = store.portfolio.addToken(balance.token.address)
        adding = null
        if (failure != null) {
            store.showToast(failure)
        } else {
            found.removeAll { it.token.id == balance.token.id }
            store.showNotice("Token added")
        }
    }
}

private fun scanStatus(count: Int): String = if (count == 0) "No new tokens found." else "$count found."

/** `tokenDiscoverFlow`: scan the registry for held tokens; nothing is added until Add is tapped. */
@Composable
fun DiscoverTokensScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val state = remember { DiscoverState() }
    Page(store, "Find held tokens", "Scan the Starknet token registry", back) {
        Caption("Nothing is added until the scan identifies a balance. Likely-spam tokens remain hidden from Home.")
        PillButton("Scan for tokens", icon = BrambleIconName.REFRESH, busy = state.busy) {
            scope.launch { state.scan(store) }
        }
        if (state.scanned && state.found.isEmpty()) Caption("No new tokens found in this account.")
        Column {
            state.found.toList().forEach { balance ->
                val token = balance.token
                val amount = compactAmount(balance.formatted, null)
                TokenRow(token.address to token.symbol, "$amount ${token.symbol}") {
                    CapsuleButton("Add", "Add ${token.symbol}", enabled = state.adding == null) {
                        scope.launch { state.add(store, balance) }
                    }
                }
            }
        }
        StatusLine(state.status, if (state.failed) StatusTone.DANGER else StatusTone.MUTED)
    }
}

/**
 * A token list row: the mark for [mark] (address to symbol), the symbol over [detail], the
 * optional [figures] (amount, then fiat), then [trailing].
 */
@Composable
private fun TokenRow(
    mark: Pair<String, String>,
    detail: String,
    figures: Pair<String, String?>? = null,
    modifier: Modifier = Modifier,
    trailing: @Composable () -> Unit,
) {
    val skin = LocalSkin.current
    val (address, symbol) = mark
    Row(
        modifier.fillMaxWidth().padding(vertical = BrambleSpace.sm),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TokenMark(address, symbol)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(symbol, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text(detail, color = skin.muted, style = textStyle(BrambleTypeScale.caption), maxLines = 1)
        }
        figures?.let { (amount, fiat) ->
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap),
            ) {
                Text(
                    amount,
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.row, BrambleWeight.bold).copy(fontFeatureSettings = "tnum"),
                )
                fiat?.let { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption)) }
            }
        }
        trailing()
    }
}

/** The Show / Hide / Add capsule: elevated fill, body ink, labelled with its token for accessibility. */
@Composable
private fun CapsuleButton(
    title: String,
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Box(
        Modifier
            .semantics(mergeDescendants = true) { contentDescription = label }
            .fillPress(skin.elevated, skin.softPress, capsule, enabled = enabled, onClick = onClick)
            .heightIn(min = BrambleControl.hitSmall)
            .padding(horizontal = BrambleSpace.md),
        contentAlignment = Alignment.Center,
    ) {
        Text(title, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.medium))
    }
}
