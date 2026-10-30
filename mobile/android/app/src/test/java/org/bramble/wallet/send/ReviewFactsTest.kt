package org.bramble.wallet.send

import org.bramble.core.FeeAffordability
import org.bramble.core.FeeAmount
import org.bramble.core.FeeUnit
import org.bramble.core.ReviewFlag
import org.bramble.core.TransferReview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The Send review's confirm face beyond its facts list: the risks panel says only what needs
 * saying (nothing at all for a plain send), and the Cost box quotes one figure, combining the
 * deployment into it on an account's first send.
 */
class ReviewFactsTest {
    private val fee = FeeAmount("3000", FeeUnit.FRI, "0.000003 STRK")
    private val deployment = FeeAmount("1000", FeeUnit.FRI, "0.000001 STRK")

    private fun review(
        flags: List<ReviewFlag> = emptyList(),
        fee: FeeAmount? = this.fee,
        deploymentFee: FeeAmount? = null,
        requiresDeployment: Boolean = false,
        affordability: FeeAffordability = FeeAffordability.SUFFICIENT,
    ) = TransferReview(
        summary = "Send 1 STRK to 0x3fa7…41a3",
        recipient = "0x3fa7",
        recipientShort = "0x3fa7…41a3",
        amountDisplay = "1",
        tokenSymbol = "STRK",
        fee = fee,
        feeEstimateFailed = fee == null,
        deploymentFee = deploymentFee,
        deploymentFeeEstimateFailed = requiresDeployment && deploymentFee == null,
        requiresDeployment = requiresDeployment,
        alreadyDeployed = false,
        affordability = affordability,
        flags = flags,
        canConfirm = true,
    )

    @Test
    fun plainSendHasNoRisksPanel() {
        assertEquals(emptyList<String>(), reviewRisks(review()))
    }

    @Test
    fun risksThenDeployNote() {
        val risks =
            reviewRisks(
                review(listOf(ReviewFlag.ADDRESS_POISONING, ReviewFlag.SELF_TRANSFER), requiresDeployment = true),
            )
        assertEquals(listOf(SendCopy.poisonedRecipient, SendCopy.selfTransfer, SendCopy.deployNote), risks)
    }

    @Test
    fun deployedSendQuotesItsFee() {
        assertEquals(ReviewCost.Figure(SendCopy.feePrefix + "0.000003 STRK", null, false), reviewCost(review()))
        val short = reviewCost(review(affordability = FeeAffordability.INSUFFICIENT))
        assertEquals(ReviewCost.Figure(SendCopy.feePrefix + "0.000003 STRK", null, true), short)
    }

    @Test
    fun firstSendCombinesFees() {
        val cost =
            reviewCost(review(deploymentFee = deployment, requiresDeployment = true)) { left, right ->
                "${left.maxSpend.toLong() + right.maxSpend.toLong()} units"
            }
        val share = SendCopy.deploymentSharePrefix + "0.000001 STRK" + SendCopy.deploymentShareSuffix
        assertEquals(ReviewCost.Figure(SendCopy.feePrefix + "4000 units", share, false), cost)
    }

    @Test
    fun missingFeesFailClosed() {
        assertEquals(ReviewCost.Failed(SendCopy.feeFailed), reviewCost(review(fee = null)))
        assertEquals(ReviewCost.Failed(SendCopy.feesFailed), reviewCost(review(requiresDeployment = true)))
        val unlike = review(deploymentFee = FeeAmount("1", FeeUnit.WEI, "1 WEI"), requiresDeployment = true)
        assertEquals(ReviewCost.Failed(SendCopy.feesFailed), reviewCost(unlike))
    }

    @Test
    fun totalAddsLikeUnitsOnly() {
        assertEquals("5 WEI", feeTotal(FeeAmount("2", FeeUnit.WEI, "2 WEI"), FeeAmount("3", FeeUnit.WEI, "3 WEI")))
        assertNull(feeTotal(fee, FeeAmount("3", FeeUnit.WEI, "3 WEI")))
        assertNull(feeTotal(FeeAmount("x", FeeUnit.WEI, "x WEI"), FeeAmount("3", FeeUnit.WEI, "3 WEI")))
    }
}
