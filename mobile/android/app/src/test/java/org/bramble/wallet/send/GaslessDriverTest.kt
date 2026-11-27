package org.bramble.wallet.send

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.bramble.core.AccountFamily
import org.bramble.core.AccountRecord
import org.bramble.core.GaslessFeeException
import org.bramble.core.GaslessFeeInterface
import org.bramble.core.GaslessOffer
import org.bramble.core.GaslessOfferStep
import org.bramble.core.GaslessPost
import org.bramble.core.GaslessSubmitStep
import org.bramble.core.HttpMethod
import org.bramble.core.HttpOutcome
import org.bramble.core.HttpRequest
import org.bramble.core.NetworkId
import org.bramble.core.PriceView
import org.bramble.core.StepReply
import org.bramble.wallet.ledger.DeviceSigning
import org.bramble.wallet.portfolio.PortfolioTransport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The host half of a gasless send (`GaslessDriver`): every request the core describes is posted
 * as described, every reply goes back to the core, and each way the core ends a submission reads
 * as the journey shows it. No paymaster is reached: the transport and the core object are scripted.
 */
class GaslessDriverTest {
    private val request = HttpRequest(HttpMethod.POST, "https://paymaster.test/rpc", emptyList(), "{}", 1024u, 1000u)
    private val reply = HttpOutcome(200u, null, "{}".toByteArray(), false)
    private val offer =
        GaslessOffer(
            "1250000",
            6u,
            "USDC",
            "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
            "1.25 USDC",
        )

    private class Transport(
        private val outcome: HttpOutcome,
    ) : PortfolioTransport {
        val posted = mutableListOf<HttpRequest>()

        override suspend fun perform(request: HttpRequest): HttpOutcome {
            posted += request
            return outcome
        }
    }

    /** A core object answering from scripts; any step past a script's end is the core's NotFound. */
    private class ScriptedFee(
        offerSteps: List<GaslessOfferStep> = emptyList(),
        private val chosen: () -> GaslessSubmitStep = { throw GaslessFeeException.NotFound() },
        submitSteps: List<() -> GaslessSubmitStep> = emptyList(),
        private val resumed: () -> GaslessSubmitStep = { throw GaslessFeeException.NotFound() },
        deviceSteps: List<GaslessSubmitStep> = emptyList(),
    ) : GaslessFeeInterface {
        private val device = ArrayDeque(deviceSteps)
        val deviceReplies = mutableListOf<StepReply>()
        private val offers = ArrayDeque(offerSteps)
        private val submits = ArrayDeque(submitSteps)
        val replies = mutableListOf<HttpOutcome>()
        var resumes = 0

        override fun acceptOfferReply(outcome: HttpOutcome): GaslessOfferStep {
            replies += outcome
            return offers.removeFirstOrNull() ?: throw GaslessFeeException.NotFound()
        }

        override fun choose(
            offer: GaslessOffer,
            prices: PriceView?,
            nowMs: ULong,
        ): GaslessSubmitStep = chosen()

        override fun resume(): GaslessSubmitStep {
            resumes += 1
            return resumed()
        }

        override fun acceptSubmitReply(
            outcome: HttpOutcome,
            nowMs: ULong,
        ): GaslessSubmitStep {
            replies += outcome
            return (submits.removeFirstOrNull() ?: { throw GaslessFeeException.NotFound() })()
        }

        override fun advanceDevice(
            reply: StepReply,
            nowMs: ULong,
        ): GaslessSubmitStep {
            deviceReplies += reply
            return device.removeFirstOrNull() ?: throw GaslessFeeException.NotFound()
        }
    }

    private fun post() = GaslessPost(request, 0u)

    /** A Ledger answering every APDU `9000`; [again] answers each refusal in turn. */
    private class Signer(
        again: List<Boolean>,
    ) : DeviceSigning {
        private val answers = ArrayDeque(again)
        var finished = 0

        val accounts = mutableListOf<AccountRecord?>()

        override suspend fun exchange(
            apdu: ByteArray,
            account: AccountRecord?,
        ): StepReply {
            accounts += account
            return StepReply.Device(OKAY)
        }

        override suspend fun refused(
            reason: String,
            account: AccountRecord?,
        ): Boolean = answers.removeFirstOrNull() ?: false

        override fun finish() {
            finished += 1
        }
    }

    @Test
    fun ledgerRelaySignsAndRetries() =
        runBlocking {
            val transport = Transport(reply)
            val apdu = byteArrayOf(0x5a, 0x02)
            val fee =
                ScriptedFee(
                    chosen = { GaslessSubmitStep.Device(apdu) },
                    submitSteps = listOf({ GaslessSubmitStep.Submitted(HASH, null) }),
                    deviceSteps =
                        listOf(
                            GaslessSubmitStep.DeviceRetry("rejected-on-device"),
                            GaslessSubmitStep.Device(apdu),
                            GaslessSubmitStep.Post(post()),
                        ),
                )
            val signer = Signer(listOf(true))
            val outcome = GaslessDriver(transport, signer = signer).submit(fee, offer, null, SIGNER)
            assertEquals("the Ledger sheet names the reviewed plan's account", listOf(SIGNER, SIGNER), signer.accounts)
            assertEquals(GaslessDriver.Outcome.Submitted(HASH, null), outcome)
            val answer = StepReply.Device(OKAY)
            assertEquals(listOf(answer, StepReply.RetryDevice, answer), fee.deviceReplies)
            assertEquals(1, signer.finished)
        }

    @Test
    fun ledgerCancelSubmitsNothing() =
        runBlocking {
            val transport = Transport(reply)
            val fee = ScriptedFee(chosen = { GaslessSubmitStep.DeviceRetry("device-locked") })
            val outcome = GaslessDriver(transport, signer = Signer(listOf(false))).submit(fee, offer, null)
            assertEquals(GaslessDriver.CANCELLED, outcome)
            assertTrue(transport.posted.isEmpty())
        }

    @Test
    fun offerRoundEndsOnCoresOffers() =
        runBlocking {
            val transport = Transport(reply)
            val fee = ScriptedFee(listOf(GaslessOfferStep.Post(post()), GaslessOfferStep.Done(listOf(offer))))
            val offers = GaslessDriver(transport).offers(fee, GaslessOfferStep.Post(post()))
            assertEquals(listOf(offer), offers)
            assertEquals(2, transport.posted.size)
            assertEquals(listOf(reply, reply), fee.replies)
        }

    @Test
    fun refusedRoundOffersNothing() =
        runBlocking {
            val offers = GaslessDriver(Transport(reply)).offers(ScriptedFee(), GaslessOfferStep.Post(post()))
            assertTrue(offers.isEmpty())
        }

    @Test
    fun choiceEndsOnRelaysHash() =
        runBlocking {
            val transport = Transport(reply)
            val fee =
                ScriptedFee(
                    chosen = { GaslessSubmitStep.Post(post()) },
                    submitSteps = listOf({ GaslessSubmitStep.Submitted(HASH, null) }),
                )
            val outcome = GaslessDriver(transport).submit(fee, offer, null)
            assertEquals(GaslessDriver.Outcome.Submitted(HASH, null), outcome)
            assertEquals(1, transport.posted.size)
        }

    @Test
    fun waitResumesThroughTheCore() =
        runBlocking {
            val transport = Transport(reply)
            val fee =
                ScriptedFee(
                    chosen = { GaslessSubmitStep.Wait(1u) },
                    resumed = { throw GaslessFeeException.Locked() },
                )
            val outcome = GaslessDriver(transport).submit(fee, offer, null)
            assertEquals(GaslessDriver.Outcome.Locked, outcome)
            assertEquals(1, fee.resumes)
            assertTrue("a locked resume posts nothing", transport.posted.isEmpty())
        }

    @Test
    fun unofferedChoiceSendsNothing() =
        runBlocking {
            val transport = Transport(reply)
            val outcome = GaslessDriver(transport).submit(ScriptedFee(), offer, null)
            assertEquals(GaslessDriver.Outcome.Moved, outcome)
            assertTrue(transport.posted.isEmpty())
        }

    @Test
    fun strayErrorAfterPostIsUnknown() =
        runBlocking {
            val transport = Transport(reply)
            val fee =
                ScriptedFee(
                    chosen = { GaslessSubmitStep.Post(post()) },
                    submitSteps = listOf({ throw IllegalStateException("binding") }),
                )
            val outcome = GaslessDriver(transport).submit(fee, offer, null)
            assertEquals(GaslessDriver.Outcome.Unknown(SendCopy.failureIndeterminate), outcome)
            assertEquals("the execute went out before the failure", 1, transport.posted.size)
        }

    @Test
    fun cancellationIsNotAnOutcome() {
        val fee = ScriptedFee(chosen = { throw CancellationException("left") })
        assertThrows(CancellationException::class.java) {
            runBlocking { GaslessDriver(Transport(reply)).submit(fee, offer, null) }
        }
    }

    @Test
    fun choiceReadsAmountAndToken() {
        assertEquals("Pay up to 1.25 USDC", payUpTo(offer))
    }

    @Test
    fun refusalsKeepCoresSentence() {
        val refused = GaslessFeeException.Refused("This network fee quote was refused. Nothing was submitted.", false)
        val lost =
            GaslessFeeException.Lost(
                "Transaction submission status is unknown. Check activity and on-chain state before retrying.",
            )
        assertEquals(GaslessDriver.Outcome.Refused(refused.reason), GaslessDriver.outcome(refused))
        assertEquals(GaslessDriver.Outcome.Unknown(lost.reason), GaslessDriver.outcome(lost))
    }

    private companion object {
        const val HASH = "0x7a1ce5"
        val OKAY = byteArrayOf(0x90.toByte(), 0)
        val SIGNER =
            AccountRecord(
                id = "SN_SEPOLIA:0x2",
                network = NetworkId.SEPOLIA,
                family = AccountFamily.OPEN_ZEPPELIN,
                classHash = "0x1",
                accountIndex = 2u,
                address = "0x2",
                publicKey = "0x3",
                deploymentSalt = null,
                label = null,
                displayName = "Account 3",
                shortAddress = "0x2",
                typeLabel = null,
                authorizationShape = "stark-pair",
                groupId = null,
                active = false,
                hidden = false,
                imported = false,
                ledger = true,
            )
    }
}
