package org.bramble.wallet

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.DisplayCurrency
import org.bramble.core.HttpOutcome
import org.bramble.core.activityValueText
import org.bramble.wallet.send.SendFlowModel
import org.bramble.wallet.send.continueWithRecipient
import org.bramble.wallet.send.updateAmount
import org.bramble.wallet.send.updateRecipient
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith
import java.net.URI

/**
 * A public send made through the store's journey records the fresh cached unit price, so its
 * Activity row can say what it was worth when sent (the extension's `withSubmittedPrice`). The
 * fixture node answers the one write with the hash the core recorded and reports it accepted, as
 * the iOS `MockNode` does; prices come from the iOS stub's CoinGecko answer ($0.50 per STRK).
 */
@RunWith(AndroidJUnit4::class)
class SendValuationTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    @Test
    fun aSendIsPricedAtSubmission() {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        val node = FixtureNode(deployed = true, funded = true)
        val chain = node.portfolioTransport()
        openPublicWalletOn(node) { request ->
            if (runCatching { URI(request.url).host }.getOrNull().orEmpty().contains("coingecko")) {
                HttpOutcome(200u, null, STRK_PRICE.toByteArray(), false)
            } else {
                chain.perform(request)
            }
        }
        r.waitForHome()
        r.waitFor(hasContentDescription("Portfolio total $", substring = true), TIMEOUT_MS)

        val record =
            onMainThread {
                val accountId = activeRecord?.id.orEmpty()
                val core = walletCore
                rpc =
                    RpcClient { url, body, write ->
                        accepting(node.post(url, body, write), body) { core.activity(accountId).firstOrNull()?.hash }
                    }
                val model = checkNotNull(makeSendModel()) { "the wallet is unlocked" }
                send(model)
                assertEquals(SendFlowModel.Stage.SUBMITTED, model.stage)
                core.activity(accountId).firstOrNull()
            }
        assertNotNull("the send was recorded", record)
        assertEquals(DisplayCurrency.USD, record?.submittedPrice?.currency)
        assertEquals(UNIT_PRICE, record?.submittedPrice?.unitPrice ?: 0.0, 0.0)
        assertEquals("\$0.75", record?.let { activityValueText(it) })
        assertNull(record?.feePaid)
    }

    private suspend fun send(model: SendFlowModel) {
        model.updateRecipient(RECIPIENT)
        model.continueWithRecipient()
        model.updateAmount("1.5")
        model.reviewSend()
        model.confirm()
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
        const val UNIT_PRICE = 0.5
        const val RECIPIENT = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3"
        const val STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
        const val STRK_PRICE = """{"$STRK":{"usd":0.5,"eur":0.45,"gbp":0.4,"usd_24h_change":2.5}}"""

        /**
         * The fixture node's [answer] to [body], except that the write is answered with the hash
         * the core recorded ([pending]) and its status read reports it accepted.
         */
        fun accepting(
            answer: String,
            body: String,
            pending: () -> String?,
        ): String {
            val request = JSONObject(body)
            val method = request.getString("method")
            val hash = if (method == "starknet_addInvokeTransaction") pending() else null
            val result =
                when {
                    hash != null -> {
                        JSONObject().put("transaction_hash", hash)
                    }

                    method == "starknet_getTransactionStatus" -> {
                        JSONObject().put("finality_status", "ACCEPTED_ON_L2").put("execution_status", "SUCCEEDED")
                    }

                    else -> {
                        null
                    }
                }
            return result?.let {
                JSONObject()
                    .put("jsonrpc", "2.0")
                    .put("id", request.get("id"))
                    .put("result", it)
                    .toString()
            } ?: answer
        }
    }
}
