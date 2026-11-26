package org.bramble.wallet.allowances

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import org.bramble.core.AllowanceList
import org.bramble.core.AllowanceView
import org.bramble.core.TokenConfig
import org.bramble.core.allowanceEntriesPerScope
import org.bramble.core.compactAmount
import org.bramble.core.formatTokenAmount
import org.bramble.core.validateRecipient
import org.bramble.wallet.WalletStore
import org.bramble.wallet.allowanceTokens
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.loadAllowances
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress

/**
 * `allowancesFlow` (`allowance-views.ts`, bound by `bindAllowances`), port of the iOS
 * `AllowancesView`: every outstanding ERC-20 allowance of the active account on this network, the
 * spender first with a copy control, the amount, contract and source on one quiet line, and a
 * Revoke control on each row the wallet can revoke. What the listing could not vouch for is said
 * above the list, and above "none found" too. Revoke opens [RevokeAllowanceScreen] in place; the
 * list is read again when it returns. Opened from Settings › Token allowances.
 */
@Composable
fun AllowancesScreen(
    store: WalletStore,
    viewActivity: () -> Unit,
    back: () -> Unit,
) {
    var revoking by remember { mutableStateOf<AllowanceView?>(null) }
    var reads by remember { mutableIntStateOf(0) }
    revoking?.let { allowance ->
        val close: () -> Unit = {
            revoking = null
            reads++
        }
        BackHandler(onBack = close)
        RevokeAllowanceScreen(store, allowance, viewActivity = viewActivity, back = close)
        return
    }
    var loading by remember { mutableStateOf(true) }
    var list by remember { mutableStateOf<AllowanceList?>(null) }
    var scopeOpen by remember { mutableStateOf(false) }
    LaunchedEffect(reads) {
        loading = true
        list = store.loadAllowances()
        loading = false
    }
    val subtitle =
        when {
            loading -> null
            list == null -> AllowanceCopy.notLoaded
            else -> AllowanceCopy.subtitle(list?.allowances?.size)
        }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(AllowanceCopy.title, subtitle = subtitle, network = store.networkLabel, back = back)
        Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm), verticalAlignment = Alignment.Top) {
            Text(
                AllowanceCopy.lede,
                color = LocalSkin.current.muted,
                style = textStyle(BrambleTypeScale.body),
                modifier = Modifier.weight(1f),
            )
            IconButton(BrambleIconName.REFRESH, AllowanceCopy.refresh, enabled = !loading) { reads++ }
        }
        Disclosure(AllowanceCopy.scopeTitle, open = scopeOpen, onToggle = { scopeOpen = !scopeOpen }) {
            Text(AllowanceCopy.scopeBody, color = LocalSkin.current.muted, style = textStyle(BrambleTypeScale.caption))
        }
        Listing(store, loading, list) { revoking = it }
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** The notices, then the empty line or the rows. */
@Composable
private fun Listing(
    store: WalletStore,
    loading: Boolean,
    list: AllowanceList?,
    revoke: (AllowanceView) -> Unit,
) {
    when {
        store.activeRecord == null -> {
            Empty(AllowanceCopy.noAccount)
        }

        loading -> {
            Empty(AllowanceCopy.loading)
        }

        list == null -> {
            Empty(AllowanceCopy.unavailable)
        }

        else -> {
            list.notices.forEach { StatusLine(AllowanceCopy.notice(it, allowanceEntriesPerScope())) }
            if (list.allowances.isEmpty()) {
                Empty(AllowanceCopy.noneFound)
            } else {
                val tokens = store.allowanceTokens
                MenuGroup {
                    list.allowances.forEachIndexed { index, allowance ->
                        if (index > 0) MenuDivider()
                        AllowanceRow(store, allowance, tokens) { revoke(allowance) }
                    }
                }
            }
        }
    }
}

/** `.empty`: centred muted copy with no box. */
@Composable
private fun Empty(message: String) {
    Text(
        message,
        color = LocalSkin.current.muted,
        textAlign = TextAlign.Center,
        style = textStyle(BrambleTypeScale.body),
        modifier = Modifier.fillMaxWidth().padding(vertical = BrambleSpace.xl),
    )
}

/**
 * `allowanceRow`: the spender (truncated, copyable), the amount line with the token contract's
 * copy control, the unconfirmed-contract and pending-revoke notes, and Revoke where it can work.
 */
@Composable
private fun AllowanceRow(
    store: WalletStore,
    allowance: AllowanceView,
    tokens: List<TokenConfig>,
    revoke: () -> Unit,
) {
    val skin = LocalSkin.current
    val token = trackedToken(allowance.token, tokens)
    Column(
        Modifier.fillMaxWidth().padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.md),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.xxs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(shortAddress(allowance.spender), color = skin.text, style = textStyle(BrambleTypeScale.mono))
            CopyButton(store, allowance.spender, AllowanceCopy.copySpender)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                rowDetail(allowance, token),
                color = skin.muted,
                style = textStyle(BrambleTypeScale.caption),
                modifier = Modifier.weight(1f, fill = false),
            )
            CopyButton(store, allowance.token, AllowanceCopy.copyTokenContract)
        }
        if (allowance.unconfirmedToken) Note(AllowanceCopy.unconfirmedToken)
        if (allowance.revoking) Note(AllowanceCopy.revoking)
        if (AllowanceCopy.canRevoke(allowance)) {
            PillButton(
                AllowanceCopy.revoke,
                Modifier.padding(top = BrambleSpace.sm).testTag("revoke-${allowance.id}"),
                kind = PillKind.DANGER,
                onClick = revoke,
            )
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(text, color = LocalSkin.current.muted, style = textStyle(BrambleTypeScale.caption))
}

/** The row's supporting line: amount, the contract when untracked, then where it came from. */
internal fun rowDetail(
    allowance: AllowanceView,
    token: TokenConfig?,
): String {
    val contract = if (token == null) " ${AllowanceCopy.ofContract} ${shortAddress(allowance.token)}" else ""
    return "${amountLabel(allowance, token)}$contract · ${AllowanceCopy.source(allowance.source)}"
}

/** `amountLabel` with `displayAmount`: the token's units when tracked, else raw base units, said so. */
internal fun amountLabel(
    allowance: AllowanceView,
    token: TokenConfig?,
): String =
    AllowanceCopy.amount(allowance) { amount ->
        val formatted =
            token?.takeIf { amount.all { it in '0'..'9' } }?.let {
                runCatching { formatTokenAmount(amount, it.decimals, it.decimals) }.getOrNull()
            }
        if (token != null && formatted != null) {
            "${compactAmount(formatted, null)} ${token.symbol}"
        } else {
            AllowanceCopy.baseUnits.replace("{amount}", compactAmount(amount, null))
        }
    }

/** The tracked token at [address], compared as canonical felts. */
internal fun trackedToken(
    address: String,
    tokens: List<TokenConfig>,
): TokenConfig? {
    val wanted = validateRecipient(address) ?: return null
    return tokens.firstOrNull { validateRecipient(it.address) == wanted }
}
