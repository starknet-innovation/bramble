package org.bramble.wallet

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.withContentDescription
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.DeploymentState
import org.bramble.wallet.send.SendCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * The Send journey on the offline [FixtureNode], port of the iOS `SendFlowTests`: recipient
 * validation, the amount gate and Max, the review (fee, amount, copy control, Back to the
 * details), the fee-failure and poisoning blocks, and Settings' deploy row with its fee quoted on
 * open. It stops at "Confirm and send" and "Deploy": those are asserted, never tapped, and the node
 * must report zero writes.
 */
@RunWith(AndroidJUnit4::class)
class SendFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    private fun open(node: FixtureNode): Robot {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        openPublicWalletOn(node)
        r.waitForHome()
        return r
    }

    private fun Robot.openDetails(address: String) {
        tap("Send")
        waitForText(SendCopy.sendTo)
        typeSecret(SendCopy.recipientFieldLabel, address)
        tap(SendCopy.continueWithAddress)
        waitFor(hasText(SendCopy.reviewLabel) and hasClickAction())
    }

    private fun Robot.review(amount: String) {
        typeSecret(SendCopy.amountLabel, amount)
        tap(SendCopy.reviewLabel)
    }

    private fun Robot.confirm() = rule.onAllNodes(hasText(SendCopy.confirmLabel) and hasClickAction())[0]

    @Test
    fun deployedSendUpToReview() {
        val node = FixtureNode(deployed = true, funded = true)
        val r = open(node)
        r.tap("Send")
        r.waitForText(SendCopy.sendTo)
        r.snapshot("send-recipient")
        r.typeSecret(SendCopy.recipientFieldLabel, "0x12345not-hex")
        r.tap(SendCopy.continueWithAddress)
        r.waitForText(SendCopy.invalidRecipient)
        r.typeSecret(SendCopy.recipientFieldLabel, RECIPIENT)
        r.tap(SendCopy.continueWithAddress)

        r.review("0")
        r.waitForText(SendCopy.amountGate)
        r.waitFor(hasText(SendCopy.max) and hasClickAction(), TIMEOUT_MS)
        r.tap(SendCopy.max)
        onView(withContentDescription(SendCopy.amountLabel)).check(matches(withText("125.5")))
        r.snapshot("send-details")
        r.tap(SendCopy.reviewLabel)

        r.waitForText("${SendCopy.feePrefix}0.008053 STRK", TIMEOUT_MS)
        r.waitForText("125.5 STRK")
        r.waitFor(
            androidx.compose.ui.test
                .hasContentDescription(SendCopy.copyRecipient),
        )
        assertFalse("nothing to warn about, so no panel", r.hasTextNow(SendCopy.riskAndRecovery.uppercase()))
        r.confirm().assertIsEnabled()
        r.snapshot("send-review")
        // No Edit button on the confirm face: Back returns to the details and drops the review.
        r.tapDescribed("Back")
        r.waitFor(hasText(SendCopy.reviewLabel) and hasClickAction())
        assertFalse("an edit drops the review", r.hasTextNow(SendCopy.confirmLabel))
        assertEquals(0, node.writes.get())
    }

    @Test
    fun undeployedReviewCombinesFees() {
        val node = FixtureNode(deployed = false, funded = true)
        val r = open(node)
        r.openDetails(RECIPIENT)
        r.review("1.5")
        // One figure for both transactions, with the deployment's share named under it.
        r.waitFor(hasText(SendCopy.feePrefix, substring = true), TIMEOUT_MS)
        r.waitFor(hasText(SendCopy.deploymentSharePrefix, substring = true))
        r.waitForText(SendCopy.riskAndRecovery.uppercase())
        r.confirm().assertIsEnabled()
        r.snapshot("send-review-undeployed")
        assertEquals(0, node.writes.get())
    }

    @Test
    fun deployRowQuotesOnOpen() {
        val node = FixtureNode(deployed = false, funded = true)
        val r = open(node)
        // Once the deployment read has landed, Home still offers no deploy row.
        rule.waitUntil(TIMEOUT_MS) { r.onMain { deployment } == DeploymentState.UNDEPLOYED }
        assertFalse("Home no longer flags an undeployed account", r.hasTextNow(SendCopy.settingsDeployRow))
        r.tapDescribed("Settings")
        r.tap("Deploy account")
        r.waitFor(hasText(SendCopy.maximumFeePrefix, substring = true), TIMEOUT_MS)
        // Asserted, never tapped: quoting is a read, so the fixture node sees no write.
        rule.onAllNodes(hasText(SendCopy.deployButton) and hasClickAction())[0].assertIsEnabled()
        r.snapshot("deploy-account")
        assertEquals(0, node.writes.get())
    }

    @Test
    fun feeFailureAndPoisoningBlock() {
        val node = FixtureNode(deployed = true, funded = true, feeFailure = true)
        val r = open(node)
        r.openDetails(RECIPIENT)
        r.review("1")
        r.waitForText(SendCopy.feeFailed, TIMEOUT_MS)
        r.waitFor(hasText(SendCopy.retryFee) and hasClickAction())
        r.waitForText(SendCopy.feeUnavailableBlock)
        r.confirm().assertIsNotEnabled()
        r.snapshot("send-review-fee-failure")
        r.tapDescribed("Back")
        r.tapDescribed("Back")

        r.typeSecret(SendCopy.recipientFieldLabel, LOOKALIKE)
        r.tap(SendCopy.continueWithAddress)
        r.review("1")
        r.waitForText(SendCopy.poisonedBlock, TIMEOUT_MS)
        r.confirm().assertIsNotEnabled()
        r.snapshot("send-review-poisoned")
        assertEquals(0, node.writes.get())
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
        const val RECIPIENT = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3"

        /** Mimics the published account's first and last characters: an address-poisoning lookalike. */
        const val LOOKALIKE = "0x2083610000000000000000000000000000000000000000000000000000098d9"
    }
}
