package org.bramble.wallet.send

import org.bramble.core.FeeAffordability
import org.bramble.core.FeeAmount
import org.bramble.core.FeeUnit
import org.bramble.core.ReviewFlag
import org.bramble.core.TransferReview
import org.bramble.core.formatTokenAmount
import java.math.BigInteger

// What the Send review's confirm face says beyond its facts list, as the extension's
// `transfer-review-markup.ts` (`reviewRisksHtml`) and `shared/review-render.ts`
// (`reviewFeeSection`): pure over the core plan's review, so the JVM tests hold it to the copy.

/**
 * The review's warnings (`reviewRisksHtml`): each risk flag's message, then the note that a first
 * send also deploys the account. Empty when there is nothing to warn about, and the risks panel
 * is then not shown at all.
 */
fun reviewRisks(review: TransferReview): List<String> =
    review.flags.map { flag ->
        when (flag) {
            ReviewFlag.SELF_TRANSFER -> SendCopy.selfTransfer
            ReviewFlag.ADDRESS_POISONING -> SendCopy.poisonedRecipient
        }
    } +
        listOfNotNull(SendCopy.deployNote.takeIf { review.requiresDeployment })

/** The Cost box's content (`reviewFeeSection`), first matching state wins. */
sealed interface ReviewCost {
    /**
     * A quoted figure: [line] is "Estimated fee: …" (for a first send, the transaction and the
     * deployment together), [share] names the deployment's part of it, and [shortfall] warns that
     * the account's STRK does not cover it.
     */
    data class Figure(
        val line: String,
        val share: String?,
        val shortfall: Boolean,
    ) : ReviewCost

    /** No figure could be quoted: [message] says which, and the box offers a retry. */
    data class Failed(
        val message: String,
    ) : ReviewCost
}

/**
 * The Cost box for [review]. A first send quotes one combined figure, the transaction plus the
 * deployment ([total], `sumFeeEstimates` then `formatFeeEstimate`), with the deployment's share
 * under it; a pair [total] cannot add (unlike units) fails closed as "both fees" rather than
 * quoting half the cost.
 */
fun reviewCost(
    review: TransferReview,
    total: (FeeAmount, FeeAmount) -> String? = ::feeTotal,
): ReviewCost {
    val fee = review.fee
    val deployment = review.deploymentFee
    val shortfall = review.affordability == FeeAffordability.INSUFFICIENT
    val combined = if (fee != null && deployment != null) total(fee, deployment) else null
    return when {
        review.requiresDeployment && deployment != null && combined != null -> {
            ReviewCost.Figure(
                SendCopy.feePrefix + combined,
                SendCopy.deploymentSharePrefix + deployment.display + SendCopy.deploymentShareSuffix,
                shortfall,
            )
        }

        review.requiresDeployment -> {
            ReviewCost.Failed(SendCopy.feesFailed)
        }

        fee != null -> {
            ReviewCost.Figure(SendCopy.feePrefix + fee.display, null, shortfall)
        }

        else -> {
            ReviewCost.Failed(SendCopy.feeFailed)
        }
    }
}

/** STRK's decimals, the scale of a FRI amount. */
private const val FRI_DECIMALS: UByte = 18u

/** `formatFri` keeps at most six fraction digits. */
private const val FRI_FRACTION_DIGITS: UByte = 6u

/**
 * `sumFeeEstimates` then `formatFeeEstimate` for two quoted fees: like units only (null
 * otherwise, or for a malformed amount); FRI reads as STRK through the core's `formatTokenAmount`,
 * any other unit as "<n> <UNIT>", exactly as the core writes [FeeAmount.display]. The core's review
 * carries each fee but not their sum, which is why the host adds them.
 */
fun feeTotal(
    left: FeeAmount,
    right: FeeAmount,
): String? {
    val sum =
        if (left.unit == right.unit) {
            runCatching { BigInteger(left.maxSpend) + BigInteger(right.maxSpend) }.getOrNull()?.toString()
        } else {
            null
        }
    return sum?.let { total ->
        when (left.unit) {
            FeeUnit.FRI -> {
                runCatching {
                    formatTokenAmount(
                        total,
                        FRI_DECIMALS,
                        FRI_FRACTION_DIGITS,
                    )
                }.getOrNull()?.let { "$it STRK" }
            }

            FeeUnit.WEI -> {
                "$total WEI"
            }
        }
    }
}
