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
 * The Deploy account flow (`bindDeploy`, iOS `DeployAccountView`) on the offline [FixtureNode]:
 * the core's deployment plan quotes the fee as the screen opens, and the one Deploy button signs
 * once and hands the write to the node. The node refuses it, so nothing is broadcast, the core
 * drops the pending record it wrote before the write left, and Deploy is offered again. An account
 * the chain already has offers nothing to deploy. The store reads its deployment through the same
 * node on entry.
 */
@RunWith(AndroidJUnit4::class)
class DeployFlowTest {
    @get:Rule val rule = createComposeRule()

    private fun show() {
        rule.setContent { BrambleTheme { DeployAccountScreen(appStore, viewActivity = {}) {} } }
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
    fun quotesOnOpenPostsOnce() {
        val node = FixtureNode(deployed = false)
        openPublicWalletOn(node)
        assertEquals(DeploymentState.UNDEPLOYED, onMainThread { deployment })
        show()
        // No press: the fee is quoted as the screen opens.
        waitForText(SendCopy.maximumFeePrefix, substring = true)
        waitForText(SendCopy.cost.uppercase())
        assertEquals("nothing is written before Deploy", 0, node.writes.get())

        tap(SendCopy.deployButton)
        // The node refuses the write: the reason shows and Deploy is offered again, to re-quote.
        rule.waitUntil(TIMEOUT_MS) { node.writes.get() == 1 && !showing(SendCopy.deploySubmitting) }
        waitForText(SendCopy.deployButton)
        assertEquals("the signed deployment is posted exactly once", 1, node.writes.get())
        assertFalse("a refused deployment is never reported submitted", showing(SendCopy.deploySubmittedTitle))
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
        waitForText(SendCopy.alreadyDeployed)
        rule.onAllNodes(hasText(SendCopy.alreadyDeployed))[0].assertIsNotEnabled()
        assertEquals(0, node.writes.get())
    }

    private fun showing(text: String): Boolean = rule.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()

    private companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
