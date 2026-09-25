package org.bramble.wallet.portfolio

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import org.bramble.core.Sparkline
import org.bramble.core.SparklineTrend
import org.bramble.core.TokenConfig
import org.bramble.core.compactAmount
import org.bramble.core.fiatValueText
import org.bramble.core.formatFiat
import org.bramble.core.tokenSparkline
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTracking
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.privacy.TokenPrivacySection
import org.bramble.wallet.send.Receipt
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress

/** The core's sparkline view box (`tokenSparkline` points are in 100 x 32 units). */
private const val SPARKLINE_WIDTH = 100.0
private const val SPARKLINE_HEIGHT = 32.0

/**
 * `tokenDetailFlow`, port of the iOS `TokenDetailView`: price with the 7-day sparkline, the
 * balance, the private half of this token ([TokenPrivacySection], from the core's
 * `tokenDetailPrivacy` over the real deployment state), and the contract receipt. [tokenId] names
 * a tracked token; one no longer tracked (a lock, a network switch) returns to the shell.
 */
@Composable
fun TokenDetailScreen(
    store: WalletStore,
    tokenId: String,
    back: () -> Unit,
    receive: () -> Unit,
    journey: () -> Unit,
) {
    val portfolio = store.portfolio
    val token = portfolio.tracked.firstOrNull { it.token.id == tokenId }?.token
    if (token == null) {
        LaunchedEffect(Unit) { back() }
        return
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(token.symbol, subtitle = token.name, network = store.networkLabel, back = back)
        PriceSection(portfolio, token)
        BalanceSection(portfolio, token)
        TokenPrivacySection(store, token.address, receive = receive, journey = journey)
        ContractSection(store, token)
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** The fiat price, the 7-day sparkline (or why there is none), and the source note. */
@Composable
private fun PriceSection(
    portfolio: PortfolioStore,
    token: TokenConfig,
) {
    val skin = LocalSkin.current
    var points by remember(token.id) { mutableStateOf(emptyList<Double>()) }
    LaunchedEffect(token.id) { points = portfolio.chart(token) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Eyebrow("Price")
        Text(
            portfolio.price(token)?.let { formatFiat(it, portfolio.currency) } ?: "Unavailable",
            color = skin.text,
            style =
                textStyle(BrambleTypeScale.amount, BrambleWeight.heavy, BrambleTracking.display)
                    .copy(fontFeatureSettings = "tnum"),
        )
        val line = tokenSparkline(points)
        if (line != null) SparklineChart(line) else StatusLine("Price history unavailable.")
        Text(
            "7-day price from CoinGecko. Shown for information only.",
            color = skin.muted,
            style = textStyle(BrambleTypeScale.caption),
        )
    }
}

/** The core's sparkline polyline, scaled from its view box to the full width. */
@Composable
private fun SparklineChart(line: Sparkline) {
    val skin = LocalSkin.current
    val color =
        when (line.trend) {
            SparklineTrend.UP -> skin.positive
            SparklineTrend.DOWN -> skin.danger
            SparklineTrend.FLAT -> skin.muted
        }
    Canvas(Modifier.fillMaxWidth().height(BrambleSize.sparkline).clearAndSetSemantics {}) {
        val path = Path()
        line.points.forEachIndexed { index, point ->
            val at =
                Offset(
                    (point.x / SPARKLINE_WIDTH * size.width).toFloat(),
                    (point.y / SPARKLINE_HEIGHT * size.height).toFloat(),
                )
            if (index == 0) path.moveTo(at.x, at.y) else path.lineTo(at.x, at.y)
        }
        drawPath(
            path,
            color,
            style = Stroke(BrambleLayout.sparklineStroke.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}

/** "Your balance": the loaded public amount and its fiat value. */
@Composable
private fun BalanceSection(
    portfolio: PortfolioStore,
    token: TokenConfig,
) {
    val skin = LocalSkin.current
    val held = portfolio.balance(token)
    val fiat = held?.let { fiatValueText(it.formatted, portfolio.price(token), portfolio.currency) }
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
        Eyebrow("Your balance")
        Text(
            "${held?.let { compactAmount(it.formatted, null) } ?: "0"} ${token.symbol}",
            color = skin.text,
            style = textStyle(BrambleTypeScale.row, BrambleWeight.bold).copy(fontFeatureSettings = "tnum"),
        )
        if (fiat != null) Text(fiat, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
    }
}

/** The contract receipt: address (with its copy control), symbol, decimals, network. */
@Composable
private fun ContractSection(
    store: WalletStore,
    token: TokenConfig,
) {
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        Eyebrow("Contract")
        Receipt(
            listOf(
                "Address" to shortAddress(token.address),
                "Symbol" to token.symbol,
                "Decimals" to token.decimals.toString(),
                "Network" to store.networkLabel,
            ),
        ) { index -> if (index == 0) CopyButton(store, token.address, "Copy token address") }
    }
}
