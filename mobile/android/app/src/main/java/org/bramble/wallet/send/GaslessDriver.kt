package org.bramble.wallet.send

import kotlinx.coroutines.delay
import org.bramble.core.GaslessFeeException
import org.bramble.core.GaslessFeeInterface
import org.bramble.core.GaslessOffer
import org.bramble.core.GaslessOfferStep
import org.bramble.core.GaslessSubmitStep
import org.bramble.core.PriceView
import org.bramble.wallet.portfolio.BoundedHttp
import org.bramble.wallet.portfolio.PortfolioTransport

/**
 * Moves one gasless choice's paymaster requests ([GaslessFee]) over the bounded HTTP path, as iOS
 * `GaslessDriver`. The core describes every request, judges every reply, checks the gateway's
 * outside execution against the reviewed transfer and signs it; this only waits the delays the
 * core asks for and hands back what came back (mobile/docs/gasless.md).
 */
class GaslessDriver(
    private val transport: PortfolioTransport = BoundedHttp,
    /** The host's wall clock in epoch milliseconds. */
    val clock: () -> Long = System::currentTimeMillis,
) {
    /** How a submission ended, as the Send journey shows it. */
    sealed interface Outcome {
        /**
         * The relay accepted the execution.
         *
         * @property hash the transaction hash the relay returned.
         * @property explorerUrl its page on the network's explorer, when there is one.
         */
        data class Submitted(
            val hash: String,
            val explorerUrl: String?,
        ) : Outcome

        /**
         * Refused before anything was submitted.
         *
         * @property reason the core's sentence.
         */
        data class Refused(
            val reason: String,
        ) : Outcome

        /**
         * The execute's answer could not be read: the relay may hold it.
         *
         * @property reason the core's sentence.
         */
        data class Unknown(
            val reason: String,
        ) : Outcome

        /** The wallet locked, or was re-unlocked, since the review. */
        data object Locked : Outcome

        /** The choice no longer matches the review (a second choice, or a new estimate). */
        data object Moved : Outcome
    }

    /**
     * Runs the offer round to its end: the offers the review may show beside STRK, possibly none.
     * A step the core refuses offers nothing; a cancelled round stops at its next pause.
     */
    suspend fun offers(
        fee: GaslessFeeInterface,
        first: GaslessOfferStep,
    ): List<GaslessOffer> {
        var step: GaslessOfferStep? = first
        while (step is GaslessOfferStep.Post) {
            pause(step.post.delayMs)
            val outcome = transport.perform(step.post.request)
            step =
                try {
                    fee.acceptOfferReply(outcome)
                } catch (ignored: GaslessFeeException) {
                    null
                }
        }
        return (step as? GaslessOfferStep.Done)?.offers.orEmpty()
    }

    /**
     * The person's choice, run to its end. Once the core has signed, the execute is posted; the
     * core filed its row first, so a lost answer stays guarded.
     */
    suspend fun submit(
        fee: GaslessFeeInterface,
        offer: GaslessOffer,
        prices: PriceView?,
    ): Outcome =
        try {
            var step = fee.choose(offer, prices, now())
            var outcome: Outcome? = null
            while (outcome == null) {
                when (val current = step) {
                    is GaslessSubmitStep.Submitted -> {
                        outcome = Outcome.Submitted(current.transactionHash, current.explorerUrl)
                    }

                    is GaslessSubmitStep.Post -> {
                        pause(current.post.delayMs)
                        step = fee.acceptSubmitReply(transport.perform(current.post.request), now())
                    }

                    is GaslessSubmitStep.Wait -> {
                        // The core posts again only if the wallet is still unlocked after the pause.
                        pause(current.delayMs)
                        step = fee.resume()
                    }
                }
            }
            outcome
        } catch (error: GaslessFeeException) {
            outcome(error)
        }

    private fun now(): ULong = clock().toULong()

    private suspend fun pause(delayMs: ULong) {
        if (delayMs > 0u) delay(delayMs.toLong())
    }

    /** The journey's reading of each core refusal. */
    companion object {
        /** The journey's reading of a core refusal. */
        fun outcome(error: GaslessFeeException): Outcome =
            when (error) {
                is GaslessFeeException.Locked -> Outcome.Locked
                is GaslessFeeException.NotFound -> Outcome.Moved
                is GaslessFeeException.Refused -> Outcome.Refused(error.reason)
                is GaslessFeeException.Lost -> Outcome.Unknown(error.reason)
            }
    }
}
