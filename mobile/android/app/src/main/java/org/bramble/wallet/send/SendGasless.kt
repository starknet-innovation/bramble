package org.bramble.wallet.send

import org.bramble.core.FeeAffordability
import org.bramble.core.GaslessBalance
import org.bramble.core.GaslessOffer
import org.bramble.core.SendException
import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode
import org.bramble.core.StepReply
import org.bramble.core.TransferPlan
import org.bramble.wallet.send.SendFlowModel.Stage

// The gasless path of [SendFlowModel] (mobile/docs/gasless.md), split from SendFlowModel.kt by
// behaviour, as iOS keeps it in an extension. The core decides every offer, checks the gateway's
// build and signs; this only sequences it. Main-thread only, like the model.

/**
 * Runs the core's offer round for the open review, only when the review already shows the STRK
 * shortfall (the core decides whether anything is offered).
 */
internal suspend fun SendFlowModel.offerGasless() {
    val host = gasless
    val plan = driver?.plan?.takeIf { reviewing(it) && review?.affordability == FeeAffordability.INSUFFICIENT }
    if (host == null || plan == null) return
    val prices = hooks.gaslessPrices(network.tokens.map { it.address })
    val held = network.tokens.map { GaslessBalance(it.address, balances[it.symbol]) }
    val round = plan.takeIf { reviewing(it) }?.gaslessOffers(prices, held, host.clock().toULong()) ?: return
    val offers = host.offers(round.fee, round.step)
    if (reviewing(plan)) {
        gaslessFee = round.fee
        gaslessOffers = offers
    }
}

/**
 * Pays the network fee in [offer]'s token instead of Confirm. The core takes the reviewed transfer
 * (closing the STRK plan), checks the gateway's build against it, and signs.
 */
suspend fun SendFlowModel.payFee(offer: GaslessOffer) {
    val host = gasless
    val fee = gaslessFee
    if (host == null || fee == null || stage != Stage.REVIEW) return
    stage = Stage.AUTHORIZING
    val outcome = host.submit(fee, offer, hooks.gaslessPrices(network.tokens.map { it.address }))
    // `choose` closed the STRK plan; the review stays for the receipt.
    driver?.plan?.cancel()
    driver = null
    gaslessFee = null
    gaslessOffers = emptyList()
    when (outcome) {
        is GaslessDriver.Outcome.Submitted -> {
            hash = outcome.hash
            relayedHash = outcome.hash
            explorerUrl = outcome.explorerUrl
            watch(outcome.hash)
        }

        is GaslessDriver.Outcome.Refused -> {
            failed(SendCopy.failurePrefix + outcome.reason)
        }

        is GaslessDriver.Outcome.Unknown -> {
            outcomeUnknown = true
            failed(outcome.reason)
        }

        GaslessDriver.Outcome.Moved -> {
            failed(SendCopy.failurePrefix + SendCopy.feeMoved)
        }

        GaslessDriver.Outcome.Locked -> {
            failed(SendFailureText.message(SendFailure(SendFailureCode.LOCKED, null)))
        }
    }
}

/** Reads a relayed transaction's status through the core, which settles its activity row. */
internal suspend fun SendFlowModel.watch(hash: String) {
    stage = Stage.CONFIRMING
    val plan =
        try {
            core.refreshActivity(account.id, hash)
        } catch (ignored: SendException) {
            stage = Stage.PENDING
            return
        }
    val started = SendDriver(plan, network, transport).also { driver = it }
    settle { started.run(StepReply.Start) }
}

private fun SendFlowModel.reviewing(plan: TransferPlan): Boolean = stage == Stage.REVIEW && driver?.plan === plan

private fun SendFlowModel.failed(message: String) {
    failureMessage = message
    stage = Stage.FAILED
}
