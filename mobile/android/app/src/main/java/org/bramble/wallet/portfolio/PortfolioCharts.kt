package org.bramble.wallet.portfolio

import org.bramble.core.ChartPlan
import org.bramble.core.TokenConfig

/**
 * `getTokenChart`: [token]'s 7-day series in the display currency, served from the core's cache or
 * fetched as it plans; empty when unavailable. A fetch that outlives a lock or scope change is
 * dropped. The core keeps the series in the price book, which is written with the next price
 * read, as the extension's cache is.
 */
suspend fun PortfolioStore.chart(token: TokenConfig): List<Double> {
    val now = System.currentTimeMillis().toDouble()
    val book = priceBook
    val currency = currency
    val plan =
        scope?.let { current ->
            runCatching { book.chartPlan(current.network.network, token.address, currency, now) }.getOrNull()
        }
    return when (plan) {
        null -> {
            emptyList()
        }

        is ChartPlan.Serve -> {
            plan.points
        }

        is ChartPlan.Fetch -> {
            val generation = readGeneration
            val outcome = transport.perform(plan.request)
            if (generation == readGeneration) book.chartApply(token.address, currency, outcome, now) else emptyList()
        }
    }
}
