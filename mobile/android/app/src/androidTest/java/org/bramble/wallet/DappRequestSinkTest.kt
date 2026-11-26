package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.bramble.core.AccountFamily
import org.bramble.core.AccountRecord
import org.bramble.core.DappReply
import org.bramble.core.DappSession
import org.bramble.core.DappSignStep
import org.bramble.core.HttpOutcome
import org.bramble.core.LedgerAccountRequest
import org.bramble.core.LedgerScheme
import org.bramble.core.NetworkId
import org.bramble.core.SiteWarning
import org.bramble.core.TokenPreferences
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

    private fun sink(
        now: () -> Double = { System.currentTimeMillis().toDouble() },
    ): Pair<DappRequestSink, AccountRecord> {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.cacheDir, UUID.randomUUID().toString())
        val core = WalletCore(dir.absolutePath, DeviceClock(context.contentResolver))
        core.createWallet("a strong password", 12u)
        val account = core.activeAccount() ?: core.addRegularAccount(NetworkId.MAINNET)
        return DappRequestSink(core, http = { HttpOutcome(0u, null, null, false) }, now = now) to account
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
    fun leftPageWithdrawsItsCard() {
        val (sink, account) = sink()
        held(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        val card = sink.cards.single()

        sink.pageGone()
        assertTrue(sink.cards.isEmpty())
        // The core holds no card either, and the stale one can no longer be approved.
        assertTrue(sink.approve(card, account.id).isEmpty())
        val accounts = now(sink.answer(request("mc_accounts"), NetworkId.MAINNET))
        assertEquals(0, accounts.getJSONObject("result").getJSONArray("accounts").length())
    }

    /** A SNIP-12 document over [message], bound to Mainnet. */
    private fun typedData(message: String = """{"content":"hello"}"""): String =
        listOf(
            """{"typed_data":{"domain":{"chainId":"SN_MAIN","name":"Bramble Test","revision":"1","version":"1"},""",
            """"message":$message,"primaryType":"Mail",""",
            """"types":{"Mail":[{"name":"content","type":"felt"}],""",
            """"StarknetDomain":[{"name":"name","type":"shortstring"},{"name":"version","type":"shortstring"},""",
            """{"name":"chainId","type":"shortstring"},{"name":"revision","type":"shortstring"}]}}}""",
        ).joinToString("")

    private fun connected(): Pair<DappRequestSink, AccountRecord> {
        val (sink, account) = sink()
        held(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        sink.approve(sink.cards.single(), account.id)
        return sink to account
    }

    /** A connected site's typed data is a sign card for the active account; Sign answers the signature. */
    @Test
    fun signingAnswersSignature() {
        val (sink, account) = connected()
        val requestId =
            held(sink.answer(DappRequest(origin, id, "wallet_signTypedData", typedData()), NetworkId.MAINNET))
        val card = sink.cards.single()
        val sign = card.sign!!
        assertEquals(account.id, sign.accountId)
        assertEquals("Mail · Bramble Test", sign.summary)
        assertTrue(sign.document.contains(""""content": "hello""""))
        assertFalse(sign.poisoned)

        val settled = runBlocking { sink.sign(card) }.single()
        assertEquals(requestId, settled.requestId)
        assertEquals(2, JSONObject(settled.json).getJSONArray("result").length())
        assertTrue(sink.cards.isEmpty())
    }

    /** A message value the types do not declare is refused before any card, so it is never shown as signed. */
    @Test
    fun undeclaredValueNeverCards() {
        val (sink, _) = connected()
        val params = typedData("""{"content":"hello","note":"not signed"}""")
        val reply = now(sink.answer(DappRequest(origin, id, "wallet_signTypedData", params), NetworkId.MAINNET))
        assertTrue(reply.has("error"))
        assertTrue(sink.cards.isEmpty())
    }

    /** A cancelled sign card holds the site off for the cooldown too, as the extension's surface does. */
    @Test
    fun deniedSignWaitsOutCooldown() {
        val (sink, _) = connected()
        val sign = DappRequest(origin, id, "wallet_signTypedData", typedData())
        held(sink.answer(sign, NetworkId.MAINNET))
        sink.deny(sink.cards.single())
        val again = now(sink.answer(sign, NetworkId.MAINNET))
        assertEquals(113, again.getJSONObject("error").getInt("code"))
        assertTrue(sink.cards.isEmpty())
    }

    /** starknet.js's SNIP-9 v2 `getTypedData` on Mainnet with one STRK call, as in `dapp_sign_outside.rs`. */
    private fun outsideExecution(
        entrypoint: String,
        calldata: List<String>,
    ): String {
        val data = calldata.joinToString(",") { "\"$it\"" }
        return listOf(
            """{"typed_data":{"types":{"StarknetDomain":[{"name":"name","type":"shortstring"},""",
            """{"name":"version","type":"shortstring"},{"name":"chainId","type":"shortstring"},""",
            """{"name":"revision","type":"shortstring"}],"OutsideExecution":[""",
            """{"name":"Caller","type":"ContractAddress"},{"name":"Nonce","type":"felt"},""",
            """{"name":"Execute After","type":"u128"},{"name":"Execute Before","type":"u128"},""",
            """{"name":"Calls","type":"Call*"}],"Call":[{"name":"To","type":"ContractAddress"},""",
            """{"name":"Selector","type":"selector"},{"name":"Calldata","type":"felt*"}]},""",
            """"primaryType":"OutsideExecution","domain":{"name":"Account.execute_from_outside",""",
            """"version":"2","chainId":"SN_MAIN","revision":"1"},"message":{"Caller":"0x414e595f43414c4c4552",""",
            """"Nonce":"0x1","Execute After":"0x1","Execute Before":"0xe8d4a50fff",""",
            """"Calls":[{"To":"$STRK","Selector":"$entrypoint","Calldata":[$data]}]}}}""",
        ).joinToString("")
    }

    /** [address] with its visible `0x` + four and last four kept, the rest changed. */
    private fun lookalike(address: String): String {
        val padded = address.removePrefix("0x").padStart(64, '0')
        return "0x" + padded.take(4) + "1".repeat(56) + padded.takeLast(4)
    }

    /** An outside execution's card says what its signature lets the site do, and lists its calls. */
    @Test
    fun outsideExecutionShowsCalls() {
        val (sink, _) = connected()
        val params = outsideExecution("approve", listOf("0x123", MAX_U128, MAX_U128))
        held(sink.answer(DappRequest(origin, id, "wallet_signTypedData", params), NetworkId.MAINNET))
        val sign = sink.cards.single().sign!!
        assertTrue(sign.outsideExecution)
        assertEquals(1, sign.calls.size)
        assertTrue(sign.risks.isNotEmpty())
        assertFalse(sign.poisoned)
    }

    /** A card paying a lookalike of a known address can only be denied: Sign answers a refusal. */
    @Test
    fun lookalikePaymentIsNeverSigned() {
        val (sink, account) = connected()
        val params = outsideExecution("transfer", listOf(lookalike(account.address), "0x1", "0x0"))
        held(sink.answer(DappRequest(origin, id, "wallet_signTypedData", params), NetworkId.MAINNET))
        val card = sink.cards.single()
        assertTrue(card.sign!!.poisoned)
        val reply = JSONObject(runBlocking { sink.sign(card) }.single().json)
        assertFalse(reply.has("result"))
        assertTrue(reply.has("error"))
    }

    /** A sign card the page left can no longer be signed. */
    @Test
    fun leftPagesSignCardIsNeverSigned() {
        val (sink, _) = connected()
        held(sink.answer(DappRequest(origin, id, "wallet_signTypedData", typedData()), NetworkId.MAINNET))
        val card = sink.cards.single()
        sink.pageGone()
        assertTrue(sink.cards.isEmpty())
        assertTrue(runBlocking { sink.sign(card) }.isEmpty())
    }

    @Test
    fun blocklistedSiteIsRefused() {
        val (sink, _) = sink()
        assertFalse(sink.isBlockedSite(origin))
        assertTrue(sink.isBlockedSite("https://starknet-airdrop.com"))
    }

    @Test
    fun cancelledSiteWaitsOutCooldown() {
        var clock = 1_000_000.0
        val (sink, _) = sink { clock }
        held(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        sink.deny(sink.cards.single())

        // Asking again at once is refused without a card.
        val again = now(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        assertEquals(113, again.getJSONObject("error").getInt("code"))
        assertTrue(sink.cards.isEmpty())

        // Once it has passed, the site may ask again.
        clock += DappRequestSink.SURFACE_COOLDOWN_MS
        held(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        assertEquals(1, sink.cards.size)
    }

    @Test
    fun signingIsRefusedWithoutACard() {
        val (sink, _) = sink()
        listOf("wallet_addInvokeTransaction", "wallet_signTypedData").forEach { method ->
            assertTrue(method, now(sink.answer(request(method), NetworkId.MAINNET)).has("error"))
        }
        assertTrue(sink.cards.isEmpty())
    }

    /** A Ledger OpenZeppelin account on Mainnet, active and connected; any chain read fails the test. */
    private fun ledgerConnected(): Triple<WalletCore, DappRequestSink, AccountRecord> {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.cacheDir, UUID.randomUUID().toString())
        val core = WalletCore(dir.absolutePath, DeviceClock(context.contentResolver))
        core.createWallet("a strong password", 12u)
        val ledger =
            core.addLedgerAccount(
                LedgerAccountRequest(
                    NetworkId.MAINNET,
                    AccountFamily.OPEN_ZEPPELIN,
                    LedgerScheme.BRAMBLE,
                    0u,
                    "0x1ed6e5",
                ),
            )
        assertTrue(ledger.ledger)
        val noRpc = RpcPost { _, _, _ -> throw AssertionError("no read expected") }
        val sink = DappRequestSink(core, rpc = noRpc, http = { HttpOutcome(0u, null, null, false) })
        held(sink.answer(request("wallet_requestAccounts"), NetworkId.MAINNET))
        sink.approve(sink.cards.single(), ledger.id)
        return Triple(core, sink, ledger)
    }

    /**
     * The core asks a Ledger account's device for the signature; with no signer on mobile yet, the
     * sink cancels it, so the page is refused (163) rather than left waiting.
     */
    @Test
    fun ledgerTypedDataEndsRefused() {
        val (core, sink, ledger) = ledgerConnected()
        val requestId =
            held(sink.answer(DappRequest(origin, id, "wallet_signTypedData", typedData()), NetworkId.MAINNET))
        val card = sink.cards.single()
        assertEquals(ledger.id, card.sign!!.accountId)
        val settled = runBlocking { sink.sign(card) }.single()
        assertEquals(requestId, settled.requestId)
        assertEquals(163, JSONObject(settled.json).getJSONObject("error").getInt("code"))
        assertTrue(sink.cards.isEmpty())

        // The same card on the core alone stops at the device, so the refusal above is the cancel.
        val session = DappSession(core, TokenPreferences(null))
        val pending = session.request(origin, "wallet_signTypedData", typedData(), NetworkId.MAINNET, 2u)
        val approvalId = (pending as DappReply.Pending).approvalId
        assertTrue(session.approveSignTypedData(approvalId, ledger.id, 0.0) is DappSignStep.Device)
        session.cancelSignDevice(approvalId)
    }

    /** A switch-network card has no screen yet: it is declined at once (113), never shown. */
    @Test
    fun switchCardDeclinedAtOnce() {
        val (sink, _) = connected()
        val params = """{"chainId":"0x534e5f5345504f4c4941"}"""
        val reply = now(sink.answer(DappRequest(origin, id, "wallet_switchStarknetChain", params), NetworkId.MAINNET))
        assertEquals(113, reply.getJSONObject("error").getInt("code"))
        assertTrue(sink.cards.isEmpty())
    }

    /** Deployment data needs a chain read the app does not make yet: refused (163) at once. */
    @Test
    fun deploymentDataRefused() {
        val (sink, _) = connected()
        val reply = now(sink.answer(request("wallet_deploymentData"), NetworkId.MAINNET))
        assertEquals(163, reply.getJSONObject("error").getInt("code"))
    }

    @Test
    fun warningsUseTheExtensionsWords() {
        assertEquals(DappCopy.siteInsightBlocklisted, DappRequestSink.warningCopy(SiteWarning.Blocklisted))
        assertEquals(
            "Domain closely resembles starknet.io; watch for a spoofed lookalike.",
            DappRequestSink.warningCopy(SiteWarning.Lookalike("starknet.io")),
        )
    }

    private companion object {
        const val STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
        const val MAX_U128 = "0xffffffffffffffffffffffffffffffff"
    }
}
