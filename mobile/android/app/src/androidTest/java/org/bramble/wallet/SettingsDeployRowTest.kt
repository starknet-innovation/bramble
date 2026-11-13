package org.bramble.wallet

import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
 * Home no longer flags an undeployed account; Settings' "This account" offers Deploy account
 * instead, whatever the deployment state (the extension's `settingsScreen`), and the screen it
 * opens says itself whether there is anything to deploy. Chain reads go through the offline
 * [FixtureNode].
 */
@RunWith(AndroidJUnit4::class)
class SettingsDeployRowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    @Test
    fun rowShownWhateverDeployment() {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        val node = FixtureNode(deployed = false)
        openPublicWalletOn(node)
        r.waitForHome()
        assertEquals(DeploymentState.UNDEPLOYED, r.onMain { deployment })
        assertFalse("Home shows no deploy notice", r.hasTextNow(SendCopy.settingsDeployRow))

        r.tapDescribed("Settings")
        r.waitForText(SendCopy.settingsThisAccount.uppercase())
        r.snapshot("settings-this-account")
        r.tap(SendCopy.settingsDeployRow)
        // The screen quotes on open: the fee, or why there is none, without a press.
        r.waitForText(SendCopy.deployTitle)
        r.waitForButton(SendCopy.deployButton, TIMEOUT_MS)
        r.tapDescribed("Back")

        node.deployed = true
        r.onMain { refreshSendState() }
        assertEquals(DeploymentState.DEPLOYED, r.onMain { deployment })
        r.tap(SendCopy.settingsDeployRow)
        r.waitForText(SendCopy.alreadyDeployed, TIMEOUT_MS)
        assertEquals("nothing reaches the node from these screens", 0, node.writes.get())
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
