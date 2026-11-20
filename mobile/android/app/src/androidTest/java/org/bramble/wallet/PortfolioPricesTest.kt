package org.bramble.wallet

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.HttpOutcome
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith
import java.net.URI

/**
 * The portfolio's priced stories on the offline [FixtureNode] plus fixed CoinGecko answers, port of
 * the iOS `PortfolioActivityTests` hero, currency and prices-offline stories: the hero total and
 * 24h line and the priced rows, the total in EUR after Appearance & currency (whose Theme section
 * stays), and, while prices fail, the header's prices notice with the balances still listed. The
 * Activity list is `ActivityScreenTest`'s; saved-data and balance-error stay iOS-only for now.
 */
@RunWith(AndroidJUnit4::class)
class PortfolioPricesTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    private fun open(pricesOnline: Boolean): Robot {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        val node = FixtureNode(deployed = true, funded = true)
        val rpc = node.portfolioTransport()
        openPublicWalletOn(node) { request ->
            if ("coingecko" in host(request.url)) prices(request.url, pricesOnline) else rpc.perform(request)
        }
        r.waitForHome()
        return r
    }

    @Test
    fun heroTotalAndCurrency() {
        val r = open(pricesOnline = true)
        // 125.5 STRK at $0.50 and 0.0421 ETH at $2,500.
        r.waitFor(hasContentDescription("Portfolio total $168.00"), TIMEOUT_MS)
        r.waitFor(hasText("% · 24h", substring = true))
        r.waitFor(hasText("STRK") and hasText("125.50"))
        r.waitFor(hasText("ETH") and hasText("0.04"))
        r.snapshot("home-priced")

        r.tapDescribed("Settings")
        r.tap("Appearance & currency")
        r.waitForText("Dark")
        r.tap("EUR")
        r.tapDescribed("Back")
        r.waitFor(hasText("· EUR", substring = true))
        r.tapDescribed("Home")
        r.waitFor(hasContentDescription("Portfolio total €", substring = true), TIMEOUT_MS)
    }

    @Test
    fun pricesOfflineKeepsBalances() {
        val r = open(pricesOnline = false)
        // The header says prices failed (the core's data issue); the hero has nothing to total and
        // the balances, which loaded, still render.
        r.waitFor(headerSays("Live prices are temporarily unavailable."), TIMEOUT_MS)
        r.waitFor(hasContentDescription("Portfolio total unavailable"))
        r.waitFor(hasText("STRK") and hasText("125.50"))
        r.snapshot("prices-offline")
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
        const val STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
        const val ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"

        /** The account header's spoken status (`stateDescription`) carries [text]. */
        fun headerSays(text: String) =
            SemanticsMatcher("header status contains '$text'") {
                it.config.getOrNull(SemanticsProperties.StateDescription)?.contains(text) == true
            }

        fun host(url: String): String = runCatching { URI(url).host }.getOrNull().orEmpty()

        /** CoinGecko's answers from the iOS `PortfolioStubResponder`, or a server error offline. */
        fun prices(
            url: String,
            online: Boolean,
        ): HttpOutcome {
            if (!online) return HttpOutcome(500u, null, "{}".toByteArray(), false)
            val body =
                when {
                    "market_chart" in url -> """{"prices":[[0,0.48],[1,0.5],[2,0.47],[3,0.52]]}"""
                    STRK in url -> """{"$STRK":{"usd":0.5,"eur":0.45,"gbp":0.4,"usd_24h_change":2.5}}"""
                    ETH in url -> """{"$ETH":{"usd":2500,"eur":2300,"gbp":1990,"usd_24h_change":-1.2}}"""
                    else -> "{}"
                }
            return HttpOutcome(200u, null, body.toByteArray(), false)
        }
    }
}
