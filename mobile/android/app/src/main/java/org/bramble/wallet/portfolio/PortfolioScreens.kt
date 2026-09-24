package org.bramble.wallet.portfolio

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import org.bramble.core.ActivityRow
import org.bramble.core.TokenBalance
import org.bramble.core.activityEmptyCopy
import org.bramble.core.activityUnavailableNotice
import org.bramble.core.portfolioAmount
import org.bramble.core.tokenRowFiat
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTracking
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.TokenMark
import org.bramble.wallet.design.textStyle

/**
 * Compose renderings of the portfolio hero, token list and Activity feed over [PortfolioStore], in
 * the design-mobile tokens (UNCOMPILED: checked against the generated Kotlin bindings). All text
 * comes from the core.
 */
@Composable
fun PortfolioHeroSection(store: PortfolioStore) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxWidth().padding(top = BrambleSpace.md), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            store.hero.totalText ?: "—",
            color = skin.text,
            textAlign = TextAlign.Center,
            style = textStyle(BrambleTypeScale.portfolio, BrambleWeight.heavy, BrambleTracking.amount),
            modifier = Modifier.semantics { contentDescription = "Portfolio total ${store.hero.totalText ?: "unavailable"}" },
        )
        store.hero.delta?.let { delta ->
            Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                Text(delta.amountText, color = if (delta.down) skin.danger else skin.positive, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
                Text(delta.windowText, color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.medium))
            }
        }
    }
}

/** The visible token rows (STRK first, hidden and likely-spam off), the failure line, the count. */
@Composable
fun PortfolioTokenList(store: PortfolioStore) {
    val skin = LocalSkin.current
    val prices = store.priceView ?: store.emptyPrices
    Column {
        StatusLine(store.balanceError, StatusTone.DANGER)
        // Public and private summed per token (`unifiedHomeBalances`, docs/privacy.md §2.2).
        store.unified.forEachIndexed { offset, row ->
            if (offset > 0) Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
            PortfolioTokenRow(row.balance, prices)
        }
        store.home?.notShown?.takeIf { it > 0u }?.let { StatusLine("Manage tokens · $it not shown") }
    }
}

@Composable
private fun PortfolioTokenRow(balance: TokenBalance, prices: org.bramble.core.PriceView) {
    val skin = LocalSkin.current
    val fiat = tokenRowFiat(balance, prices)
    Row(
        Modifier.fillMaxWidth().heightIn(min = BrambleSize.rowCompact).padding(horizontal = BrambleSpace.sm, vertical = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TokenMark(balance.token.address, balance.token.symbol)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(balance.token.symbol, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text(portfolioAmount(balance.formatted), color = skin.muted, style = textStyle(BrambleTypeScale.body).copy(fontFeatureSettings = "tnum"))
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(fiat.valueText ?: "—", color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.bold))
            fiat.change?.let { Text(it.text, color = if (it.up) skin.positive else skin.danger, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold)) }
        }
    }
}

/** The account's one activity list (submitted and on-chain rows), grouped by UTC day. */
@Composable
fun PortfolioActivity(store: PortfolioStore) {
    val skin = LocalSkin.current
    val unavailable = store.activityView?.historyUnavailable == true
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        if (unavailable) StatusLine(activityUnavailableNotice())
        if (store.groups.isEmpty()) {
            Text(
                activityEmptyCopy(unavailable),
                color = skin.muted,
                textAlign = TextAlign.Center,
                style = textStyle(BrambleTypeScale.label),
                modifier = Modifier.fillMaxWidth().padding(vertical = BrambleSpace.lg, horizontal = BrambleSpace.md),
            )
        }
        store.groups.forEach { group ->
            Text(group.heading, color = skin.muted, style = textStyle(BrambleTypeScale.body, BrambleWeight.medium))
            group.rows.forEach { ActivityRowItem(it) }
        }
    }
}

@Composable
private fun ActivityRowItem(row: ActivityRow) {
    val skin = LocalSkin.current
    val uri = LocalUriHandler.current
    Row(
        Modifier.fillMaxWidth().padding(vertical = BrambleSpace.sm).semantics { contentDescription = row.accessibilityLabel },
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            // The explorer opens in the system browser (ACTION_VIEW through the URI handler).
            val link = row.explorerUrl
            Text(
                row.title,
                color = skin.text,
                style = textStyle(BrambleTypeScale.row, BrambleWeight.medium),
                modifier = if (link != null) Modifier.clickable { uri.openUri(link) } else Modifier,
            )
            row.detail?.let { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption)) }
            row.statusWord?.let { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold)) }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(row.fiatText ?: "—", color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.medium))
            Text(row.amountText ?: "—", color = skin.muted, style = textStyle(BrambleTypeScale.body))
        }
    }
}
