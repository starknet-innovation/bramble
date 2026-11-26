package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.bramble.core.AccountRecord
import org.bramble.core.HttpOutcome
import org.bramble.core.NetworkId
import org.bramble.core.SiteWarning
import org.bramble.core.WalletCore
import org.bramble.wallet.browser.DappCopy
import org.bramble.wallet.browser.DappRequest
import org.bramble.wallet.browser.DappRequestSink
import org.bramble.wallet.security.DeviceClock
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Connect through wallet-core's `DappSession`, as the browser drives it (P16), as iOS
 * `DappRequestSinkTests`: a site's `wallet_requestAccounts` is held as a card; approving it answers
 * the page with the active account's address, denying it answers 113, and a method outside the
 * connect slice is refused without a card.
 */
@RunWith(AndroidJUnit4::class)
class DappRequestSinkTest {
    private val origin = "https://app.example.com"
    private val id = "0f8fad5b-d9cb-469f-a165-70867728950e"

    private fun sink(): Pair<DappRequestSink, AccountRecord> {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.cacheDir, UUID.randomUUID().toString())
        val core = WalletCore(dir.absolutePath, DeviceClock(context.contentResolver))
        core.createWallet("a strong password", 12u)
        val account = core.activeAccount() ?: core.addRegularAccount(NetworkId.MAINNET)
        return DappRequestSink(core, http = { HttpOutcome(0u, null, null, false) }) to account
    }

    private fun request(method: String) = DappRequest(origin, id, method)

    private fun held(answer: DappRequestSink.Answer): ULong = (answer as DappRequestSink.Answer.Held).requestId

    private fun now(answer: DappRequestSink.Answer): JSONObject =
        JSONObject((answer as DappRequestSink.Answer.Now).json)

    @Test
    fun approveAnswersActiveAccount() {
        val (sink, account) = sink()
        val requestId = held(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        val card = sink.cards.single()
        assertEquals(origin, card.origin)
        assertFalse(card.blocked)

        val settled = sink.approve(card, account.id).single()
        assertEquals(requestId, settled.requestId)
        val reply = JSONObject(settled.json)
        assertEquals(id, reply.getString("id"))
        assertEquals(account.address, reply.getJSONArray("result").getString(0))
        assertTrue(sink.cards.isEmpty())

        // Connected now: the next ask is answered at once, without a card.
        val again = now(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        assertEquals(account.address, again.getJSONArray("result").getString(0))
    }

    @Test
    fun denyAnswersUserRefused() {
        val (sink, _) = sink()
        held(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        val reply = JSONObject(sink.deny(sink.cards.single()).single().json)
        assertEquals(113, reply.getJSONObject("error").getInt("code"))
        assertFalse(reply.has("result"))
        assertTrue(sink.cards.isEmpty())
        val accounts = now(sink.answer(request("mc_accounts"), NetworkId.MAINNET))
        assertEquals(0, accounts.getJSONObject("result").getJSONArray("accounts").length())
    }

    @Test
    fun signingIsRefusedWithoutACard() {
        val (sink, _) = sink()
        listOf("wallet_addInvokeTransaction", "wallet_signTypedData").forEach { method ->
            assertTrue(method, now(sink.answer(request(method), NetworkId.MAINNET)).has("error"))
        }
        assertTrue(sink.cards.isEmpty())
    }

    @Test
    fun warningsUseTheExtensionsWords() {
        assertEquals(DappCopy.siteInsightBlocklisted, DappRequestSink.warningCopy(SiteWarning.Blocklisted))
        assertEquals(
            "Domain closely resembles starknet.io; watch for a spoofed lookalike.",
            DappRequestSink.warningCopy(SiteWarning.Lookalike("starknet.io")),
        )
    }
}
