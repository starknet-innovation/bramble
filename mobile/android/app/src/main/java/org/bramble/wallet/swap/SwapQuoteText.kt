package org.bramble.wallet.swap

import org.bramble.core.SwapQuoteView
import org.bramble.core.TokenConfig
import java.util.Locale

/** Percent scale of a value delta. */
private const val PERCENT = 100.0

/** `toFixed(4)` for a rate of 1 and over, `toFixed(10)` under it (`paintSwapMeta`). */
private const val WHOLE_RATE_DIGITS = 4
private const val FRACTION_RATE_DIGITS = 10

/**
 * The pair the journey opens on (`swapPresetPair`, `healSelection`): the chosen token id, else
 * ETH, else the first; bought against STRK, else the first other token.
 */
fun openingPair(
    opening: String?,
    tokens: List<TokenConfig>,
): Pair<TokenConfig?, TokenConfig?> {
    val sell =
        tokens.firstOrNull { it.id == opening } ?: tokens.firstOrNull { it.symbol == "ETH" } ?: tokens.firstOrNull()
    val others = tokens.filter { it.id != sell?.id }
    return sell to (others.firstOrNull { it.symbol == "STRK" } ?: others.firstOrNull())
}

/**
 * `swapValueDeltaPercent`: the worse of the wallet's feed delta and the aggregator's own USD
 * figures, so neither can hide a loss the other shows; null when neither has a figure.
 */
fun valueDelta(quote: SwapQuoteView): Double? {
    val aggregator =
        if (quote.sellAmountInUsd > 0) {
            (quote.buyAmountInUsd - quote.sellAmountInUsd) / quote.sellAmountInUsd * PERCENT
        } else {
            null
        }
    val feed = quote.valueDeltaPercent ?: return aggregator
    return aggregator?.let { minOf(feed, it) } ?: feed
}

/**
 * Review swap's label (`paintSwapMeta`): "Insufficient SYMBOL" when [shortSymbol] is set, "Swap
 * anyway (−x%)" when the quote's [loss] reaches the high-risk tier, else "Review swap".
 */
fun reviewLabel(
    shortSymbol: String?,
    loss: Double?,
): String =
    when {
        shortSymbol != null -> {
            SwapCopy.insufficientToken.replace("{symbol}", shortSymbol)
        }

        loss != null && loss >= SwapCopy.lossHighRiskPercent -> {
            SwapCopy.swapAnyway.replace("{percent}", String.format(Locale.ROOT, "%.1f", loss))
        }

        else -> {
            SwapCopy.review
        }
    }

/** "1 ETH = 1250 STRK", trailing zeros trimmed; null for no rate. */
fun rateLine(
    quote: SwapQuoteView,
    sell: String,
    buy: String,
): String? {
    val sold = quote.sellAmount.toDoubleOrNull()
    val bought = quote.buyAmount.toDoubleOrNull()
    val rate = if (sold != null && bought != null) bought / sold else null
    if (rate == null || !rate.isFinite() || rate <= 0) return null
    val digits = if (rate >= 1) WHOLE_RATE_DIGITS else FRACTION_RATE_DIGITS
    val text = String.format(Locale.ROOT, "%.${digits}f", rate).trimEnd('0').trimEnd('.')
    return "1 $sell = $text $buy"
}

/** `a > b` for base-10 integer strings. */
fun decimalGreater(
    left: String,
    right: String,
): Boolean {
    val lhs = left.trimStart('0')
    val rhs = right.trimStart('0')
    return if (lhs.length == rhs.length) lhs > rhs else lhs.length > rhs.length
}
