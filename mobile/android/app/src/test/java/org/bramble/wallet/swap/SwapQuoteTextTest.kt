package org.bramble.wallet.swap

import org.bramble.core.NetworkId
import org.bramble.core.SwapQuoteView
import org.bramble.core.TokenConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Swap screen's own arithmetic (`swap-ui.ts`, `swap-client.ts`, `swap-preset.ts`), iOS
 * `SwapFlowModelTests`: the pair it opens on, the worse-of-two loss, the review label's tiers, the
 * rate line and the balance comparison. Every decision about the swap itself is the core's.
 */
class SwapQuoteTextTest {
    private fun token(symbol: String) = TokenConfig("id-$symbol", NetworkId.SEPOLIA, "0x$symbol", symbol, symbol, 18u)

    private fun quote(feed: Double?) = SwapQuoteView("0.01", "12.5", 20.0, 19.0, 0.02, feed)

    @Test
    fun openingPair() {
        val tokens = listOf(token("USDC"), token("ETH"), token("STRK"))
        assertEquals("ETH" to "STRK", openingPair(null, tokens).let { it.first?.symbol to it.second?.symbol })
        assertEquals("STRK" to "USDC", openingPair("id-STRK", tokens).let { it.first?.symbol to it.second?.symbol })
    }

    @Test
    fun worseDeltaWins() {
        assertEquals(-5.0, valueDelta(quote(null))!!, 1e-9)
        assertEquals("the feed shows a loss the aggregator hides", -20.0, valueDelta(quote(-20.0))!!, 1e-9)
        assertEquals("and the aggregator one the feed hides", -5.0, valueDelta(quote(3.0))!!, 1e-9)
    }

    @Test
    fun reviewLabelTiers() {
        assertEquals("Insufficient ETH", reviewLabel("ETH", 30.0))
        assertEquals("Swap anyway (−15.0%)", reviewLabel(null, 15.0))
        assertEquals(SwapCopy.review, reviewLabel(null, 14.9))
        assertEquals(SwapCopy.review, reviewLabel(null, null))
    }

    @Test
    fun rateAndBalanceComparison() {
        assertEquals("1 ETH = 1250 STRK", rateLine(quote(null), "ETH", "STRK"))
        assertTrue(decimalGreater("10", "9"))
        assertFalse(decimalGreater("009", "10"))
    }
}
