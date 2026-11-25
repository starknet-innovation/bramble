package org.bramble.wallet

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.HttpOutcome
import org.bramble.wallet.portfolio.PortfolioTransport
import org.bramble.wallet.swap.SwapCopy
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * The Swap journey from Home (`swap-ui.ts`, iOS `SwapFlowTests`) on the offline [FixtureNode] and a
 * canned AVNU with wallet-core's `tests/swap.rs` replies (0.01 ETH for 12.5 STRK): the quote, the
 * review in the core's words with the enforced minimum, and nothing written before Confirm swap,
 * which is asserted, never tapped. With AVNU unanswered the quote fails closed in the core's
 * sentence and Review swap stays disabled.
 */
@RunWith(AndroidJUnit4::class)
class SwapFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    private fun open(
        node: FixtureNode,
        avnu: PortfolioTransport,
    ): Robot {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        val rpc = node.portfolioTransport()
        openPublicWalletOn(node) { request ->
            if ("api.avnu.fi" in request.url) avnu.perform(request) else rpc.perform(request)
        }
        r.waitForHome()
        r.tap(SwapCopy.homeAction)
        r.typeSecret(SwapCopy.amountToSell, "0.01")
        return r
    }

    @Test
    fun quotesAndReviewsWithoutWriting() {
        val node = FixtureNode(deployed = true, funded = true)
        val r = open(node, CannedAvnu)
        r.waitForText("12.5", timeoutMs = TIMEOUT_MS)
        r.tap(SwapCopy.review)
        r.waitForText(SwapCopy.minimumReceived, timeoutMs = TIMEOUT_MS)
        r.waitFor(hasText("12.4375 STRK"))
        r.waitFor(hasText("Swap 0.01 ETH for at least 12.4375 STRK", substring = true))
        r.waitForButton(SwapCopy.confirm)
        assertEquals("nothing is written before Confirm swap", 0, node.writes.get())
    }

    @Test
    fun unansweredQuoteFailsClosed() {
        val node = FixtureNode(deployed = true, funded = true)
        val r = open(node) { HttpOutcome(0u, null, null, false) }
        r.waitForText("swap quote failed", timeoutMs = TIMEOUT_MS)
        rule.onAllNodes(hasText(SwapCopy.review) and hasClickAction())[0].assertIsNotEnabled()
        assertEquals(0, node.writes.get())
    }

    /** AVNU's quote and an honest build (the pinned router, the reviewed floor, this account). */
    private object CannedAvnu : PortfolioTransport {
        private const val ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
        private const val STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
        private const val SELL = "0x2386f26fc10000"
        private const val BUY = "0xad78ebc5ac620000"
        private const val MIN_BUY = "0xac9ae05a71ebc000"
        private const val EXCHANGE = "0x1114c7103e12c2b2ecbd3a2472ba9c48ddcbf702b1c242dd570057e26212111"

        /** AVNU's published exchange per network, as wallet-core's `SWAP_POLICY` pins it. */
        private val routers =
            mapOf(
                "starknet.api.avnu.fi" to
                    ("0x534e5f4d41494e" to "0x4270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f"),
                "sepolia.api.avnu.fi" to
                    ("0x534e5f5345504f4c4941" to "0x2c56e8b00dbe2a71e57472685378fc8988bba947e9a99b26a00fade2b4fe7c2"),
            )

        override suspend fun perform(request: org.bramble.core.HttpRequest): HttpOutcome {
            val (chain, router) = routers.entries.first { request.url.contains("//${it.key}/") }.value
            val body = if ("/quotes?" in request.url) quote() else build(chain, router)
            return HttpOutcome(HTTP_OK, null, body.toByteArray(), false)
        }

        private fun quote() =
            """[{"buyAmount":"$BUY","buyAmountInUsd":18.8,"buyTokenAddress":"$STRK","gasFeesInUsd":0.025,""" +
                """"quoteId":"dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca","sellAmount":"$SELL",""" +
                """"sellAmountInUsd":18.79,"sellTokenAddress":"$ETH"}]"""

        private fun build(
            chain: String,
            router: String,
        ): String {
            val route =
                listOf(
                    ETH,
                    SELL,
                    "0x0",
                    STRK,
                    BUY,
                    "0x0",
                    MIN_BUY,
                    "0x0",
                    PublicWallet.ADDRESS,
                    "0x0",
                    "0x0",
                    "0x1",
                    ETH,
                    STRK,
                    EXCHANGE,
                    "0x2540be400",
                    "0x2",
                    "0x1f4",
                    "0x0",
                )
            val felts = { values: List<String> -> values.joinToString(",") { "\"$it\"" } }
            return """{"chainId":"$chain","calls":[""" +
                """{"contractAddress":"$ETH","entrypoint":"approve","calldata":[${felts(
                    listOf(router, SELL, "0x0"),
                )}]},""" +
                """{"contractAddress":"$router","entrypoint":"multi_route_swap","calldata":[${felts(route)}]}]}"""
        }
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
        const val HTTP_OK: UShort = 200u
    }
}
