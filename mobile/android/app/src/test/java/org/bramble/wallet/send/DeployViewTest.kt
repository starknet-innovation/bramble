package org.bramble.wallet.send

import org.bramble.core.FeeAmount
import org.bramble.core.FeeUnit
import org.bramble.wallet.send.DeployFlowModel.Stage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Deploy account form as the extension's `bindDeploy` now paints it: the fee is quoted on
 * open, one Deploy button submits under it, a failed quote says so and leaves Deploy pressable to
 * quote again, and the receipt firms up from "submitted" to "deployed".
 */
class DeployViewTest {
    private val fee = FeeAmount("8053000000000000", FeeUnit.FRI, "0.008053 STRK")

    @Test
    fun quotesOnOpen() {
        // A new model opens quoting: the status reads "Estimating fee…" and Deploy waits.
        val view = deployView(Stage.QUOTING, null, null)
        assertEquals(SendCopy.deployEstimating, view.status)
        assertNull("no figure is shown before the quote", view.cost)
        assertEquals(SendCopy.deployButton, view.button)
        assertFalse(view.enabled)
        assertTrue(view.busy)
    }

    @Test
    fun oneButtonSubmitsUnderTheQuote() {
        val quoted = deployView(Stage.READY, fee, null)
        assertEquals(SendCopy.maximumFeePrefix + "0.008053 STRK", quoted.cost)
        assertFalse(quoted.costFailed)
        assertEquals(SendCopy.deployButton, quoted.button)
        assertTrue(quoted.enabled)
        assertNull(quoted.status)

        val submitting = deployView(Stage.SUBMITTING, fee, null)
        assertEquals(SendCopy.deploySubmitting, submitting.status)
        assertFalse(submitting.enabled)
        assertTrue(submitting.busy)
    }

    @Test
    fun failedQuoteQuotesAgain() {
        val view = deployView(Stage.READY, null, SendCopy.deployEstimateFailed)
        assertEquals(SendCopy.deployEstimateFailed, view.cost)
        assertTrue(view.costFailed)
        assertTrue("Deploy quotes again on press", view.enabled)
        assertEquals(SendCopy.deployButton, view.button)
    }

    @Test
    fun alreadyDeployedOffersNothing() {
        val view = deployView(Stage.ALREADY_DEPLOYED, null, null)
        assertEquals(SendCopy.alreadyDeployed, view.button)
        assertFalse(view.enabled)
        assertNull(view.cost)
        assertNull(view.status)
    }

    @Test
    fun receiptFirmsUpOnConfirmation() {
        assertEquals(SendCopy.deploySubmittedTitle to null, deployReceipt(confirmed = false))
        assertEquals(SendCopy.deployConfirmedTitle to SendCopy.deployConfirmedBody, deployReceipt(confirmed = true))
    }
}
