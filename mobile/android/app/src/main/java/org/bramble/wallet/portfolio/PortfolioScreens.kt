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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import org.bramble.core.TokenBalance
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
 * Compose renderings of the portfolio hero and token list over [PortfolioStore], in the
 * design-mobile tokens. All text comes from the core. The Activity feed is `ActivityScreen.kt`.
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
            modifier =
                Modifier.semantics {
                    contentDescription =
                        "Portfolio total ${store.hero.totalText ?: "unavailable"}"
                },
        )
        store.hero.delta?.let { delta ->
            Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
                Text(
                    delta.amountText,
                    color = if (delta.down) skin.danger else skin.positive,
                    style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold),
                )
                Text(
                    delta.windowText,
                    color = skin.muted,
                    style = textStyle(BrambleTypeScale.label, BrambleWeight.medium),
                )
            }
        }
    }
}

/**
 * The visible token rows (STRK first, hidden and likely-spam off), the failure line, the count.
 * Tapping a row opens its detail through [open] with the row's token id.
 */
@Composable
fun PortfolioTokenList(
    store: PortfolioStore,
    open: (String) -> Unit,
) {
    val skin = LocalSkin.current
    val prices = store.priceView ?: store.emptyPrices
    Column {
        StatusLine(store.balanceError, StatusTone.DANGER)
        // Public and private summed per token (`unifiedHomeBalances`, docs/privacy.md §2.2).
        store.unified.forEachIndexed { offset, row ->
            if (offset > 0) Box(Modifier.fillMaxWidth().height(BrambleLayout.hairline).background(skin.hairline))
            PortfolioTokenRow(row.balance, prices) { open(row.balance.token.id) }
        }
        store.home
            ?.notShown
            ?.takeIf { it > 0u }
            ?.let { StatusLine("Manage tokens · $it not shown") }
    }
}

@Composable
private fun PortfolioTokenRow(
    balance: TokenBalance,
    prices: org.bramble.core.PriceView,
    open: () -> Unit,
) {
    val skin = LocalSkin.current
    val fiat = tokenRowFiat(balance, prices)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClickLabel = "Open ${balance.token.symbol}", role = Role.Button, onClick = open)
            .heightIn(
                min = BrambleSize.rowCompact,
            ).padding(horizontal = BrambleSpace.sm, vertical = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TokenMark(balance.token.address, balance.token.symbol)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(
                balance.token.symbol,
                color = skin.text,
                style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold),
            )
            Text(
                portfolioAmount(balance.formatted),
                color = skin.muted,
                style = textStyle(BrambleTypeScale.body).copy(fontFeatureSettings = "tnum"),
            )
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap),
        ) {
            Text(fiat.valueText ?: "—", color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.bold))
            fiat.change?.let {
                Text(
                    it.text,
                    color = if (it.up) skin.positive else skin.danger,
                    style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold),
                )
            }
        }
    }
}
