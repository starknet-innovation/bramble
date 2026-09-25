package org.bramble.wallet

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.ActivityKind
import org.bramble.core.DeploymentState
import org.bramble.wallet.design.BrambleTheme
import org.bramble.wallet.send.DeployAccountScreen
import org.bramble.wallet.send.SendCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Deploy account flow (`deployAccountFlow`, iOS `DeployAccountView`) on the offline
 * [FixtureNode]: the core's deployment plan reviews the fee, and a confirm signs once and hands
 * the write to the node. The node refuses it, so nothing is broadcast and the core drops the
 * pending record it wrote before the write left. An account the chain already has offers nothing
 * to deploy. The store reads its deployment through the same node on entry.
 */
@RunWith(AndroidJUnit4::class)
class DeployFlowTest {
    @get:Rule val rule = createComposeRule()

    private fun show() {
        rule.setContent { BrambleTheme { DeployAccountScreen(appStore) {} } }
    }

    private fun waitForText(
        text: String,
        substring: Boolean = false,
    ) = rule.waitUntil(TIMEOUT_MS) {
        rule.onAllNodes(hasText(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()
    }

    private fun tap(text: String) {
        waitForText(text)
        rule.onAllNodes(hasText(text) and hasClickAction())[0].performClick()
    }

    @Test
    fun reviewsFeeSignsOnceNoBroadcast() {
        val node = FixtureNode(deployed = false)
        openPublicWalletOn(node)
        assertEquals(DeploymentState.UNDEPLOYED, onMainThread { deployment })
        show()
        tap(SendCopy.reviewDeployment)
        waitForText(SendCopy.confirmDeploymentPrefix, substring = true)
        waitForText(SendCopy.maximumFeePrefix, substring = true)
        assertEquals("nothing is written before Confirm", 0, node.writes.get())

        rule
            .onAllNodes(
                hasText(SendCopy.confirmDeploymentPrefix, substring = true) and hasClickAction(),
            )[0]
            .performClick()
        // The node refuses the write, so the flow fails and offers a new review.
        waitForText(SendCopy.reviewDeployment)
        assertEquals("the signed deployment is posted exactly once", 1, node.writes.get())
        val accountId = onMainThread { activeRecord?.id }.orEmpty()
        val logged = onMainThread { walletCore.activity(accountId) }
        assertFalse(
            "a deployment the node refused never existed, so the core drops its pending record",
            logged.any { it.kind == ActivityKind.DEPLOY },
        )
    }

    @Test
    fun alreadyDeployedHasNothingToDo() {
        val node = FixtureNode(deployed = true)
        openPublicWalletOn(node)
        assertEquals(DeploymentState.DEPLOYED, onMainThread { deployment })
        show()
        tap(SendCopy.reviewDeployment)
        waitForText(SendCopy.alreadyDeployed)
        rule.onAllNodes(hasText(SendCopy.alreadyDeployed))[0].assertIsNotEnabled()
        assertEquals(0, node.writes.get())
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
