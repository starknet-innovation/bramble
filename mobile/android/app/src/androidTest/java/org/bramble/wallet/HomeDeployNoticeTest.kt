package org.bramble.wallet

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.DeploymentState
import org.bramble.core.ShieldTile
import org.bramble.core.shieldTile
import org.bramble.wallet.send.SendCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * Home's deploy notice and Shield gate follow the core's judgement of the account's deployment,
 * read through the store's RPC client (here the offline [FixtureNode]), never an assumed Unknown.
 * The notice's label depends on the STRK balance the portfolio reads (mainnet, as the onboarding
 * suite does), so the test takes the label from the store and checks the screen shows it.
 */
@RunWith(AndroidJUnit4::class)
class HomeDeployNoticeTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    @Test
    fun noticeFollowsDeployment() {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        val node = FixtureNode(deployed = false)
        openPublicWalletOn(node)
        r.waitForHome()
        assertEquals(DeploymentState.UNDEPLOYED, r.onMain { deployment })
        // The balance read settles (loaded or failed) before the label is decided.
        rule.waitUntil(BALANCE_TIMEOUT_MS) { r.onMain { portfolio.balances != null || portfolio.balanceError != null } }
        val notice = r.onMain { deployNotice }
        val label = if (notice == DeployNotice.FUND) SendCopy.fundChip else SendCopy.deployChip
        assertFalse("an undeployed account shows the notice", notice == DeployNotice.HIDDEN)
        r.waitForButton(label)
        val tile = r.onMain { shieldTile(network, deployment, strkFunded, privacy.reading) }
        assertFalse("an undeployed account never offers Activate", tile == ShieldTile.ACTIVATE)
        r.snapshot("deploy-notice")

        if (notice == DeployNotice.DEPLOY) {
            r.tap(SendCopy.deployChip)
            r.waitForButton(SendCopy.reviewDeployment)
            r.tapDescribed("Back")
        } else {
            r.tap(SendCopy.fundChip)
            r.waitForButton("Copy address")
            r.tapDescribed("Back")
        }

        node.deployed = true
        r.onMain { refreshSendState() }
        assertEquals(DeploymentState.DEPLOYED, r.onMain { deployment })
        rule.waitUntil { !r.hasTextNow(SendCopy.deployChip) && !r.hasTextNow(SendCopy.fundChip) }
        assertFalse(rule.onAllNodes(hasText(label) and hasClickAction()).fetchSemanticsNodes().isNotEmpty())
    }

    private companion object {
        const val BALANCE_TIMEOUT_MS = 30_000L
    }
}
