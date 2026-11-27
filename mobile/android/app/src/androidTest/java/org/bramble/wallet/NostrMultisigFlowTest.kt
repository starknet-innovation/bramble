package org.bramble.wallet

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.bramble.wallet.ui.shortAddress
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * Shared accounts on the offline [FixtureNode], port of the create and saved-setup stories of the
 * iOS `NostrMultisigFlowTests`: create a 2-of-2 with the co-signer's wallet card (from
 * `ui-coordination.json`, which the Rust suite writes and verifies), see Fund show the predicted
 * address and a zero balance, find Deploy disabled, then open the saved setup from the list, resume
 * it, and stop watching it. The relay sync and add-by-address stories need a scripted relay and
 * authority answers this node does not model, so they stay iOS-only for now.
 */
@RunWith(AndroidJUnit4::class)
class NostrMultisigFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    private fun fixture(): JSONObject {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        return JSONObject(assets.open("ui-coordination.json").bufferedReader().use { it.readText() })
    }

    @Test
    fun createFundResumeSharedAccount() {
        val fixture = fixture()
        val predicted = shortAddress(fixture.getString("predictedAddress"))
        val node = FixtureNode(deployed = true)
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        openPublicWalletOn(node)
        r.waitForHome()

        r.tapDescribed("Settings")
        r.tap("Shared accounts")
        r.waitForText("No shared accounts are saved on this network yet.")
        r.tap("Create a multisig")
        r.waitForText("1 signer")
        r.tap("Add participant")
        r.tap("Wallet card")
        r.typeSecret("Participant name", "Bob")
        r.typeSecret("Shared wallet card", fixture.getString("cosignerCardMainnet"))
        r.tap("Add participant")
        r.waitForText("2 signers")
        r.snapshot("participants")
        r.tap("Continue to approval")
        r.typeSecret("Signatures required", "2")
        r.waitFor(hasText("Review deployment") and hasClickAction() and isEnabled(), TIMEOUT_MS)
        r.tap("Review deployment")

        r.waitForText("Fund this multisig", TIMEOUT_MS)
        r.waitForText(predicted)
        r.snapshot("fund")
        r.tap("Check funding")
        r.waitForText("Balance: 0 STRK", TIMEOUT_MS)
        r.tap("Continue to deploy")
        r.waitFor(hasText("Deploy multisig"))
        rule.onAllNodes(hasText("Deploy multisig"))[0].assertIsNotEnabled()
        r.waitForText(
            "Deployment from mobile arrives with sending. Deploy this saved setup from Bramble for browser, " +
                "or come back after the update.",
        )
        r.tapDescribed("Back")

        // The saved setup is listed with its threshold, opens to its home, and resumes.
        r.waitFor(hasText(predicted) and hasText("2 of 2 signers"), TIMEOUT_MS)
        r.tap(predicted)
        r.tap("Deploy")
        // Resuming opens the saved setup at Approval, its signers restored.
        r.waitForText("Complete multisig setup", TIMEOUT_MS)
        r.waitForText("Review deployment")
        r.tapDescribed("Back")
        r.tap("Transactions")
        r.waitForText("Co-signer updates")
        r.snapshot("shared-home")
        r.tap("Stop watching")
        r.waitForText("Stop watching this shared account?")
        r.tap("Stop watching")
        r.waitForText("No shared accounts are saved on this network yet.", TIMEOUT_MS)
        assertEquals("nothing is ever broadcast", 0, node.writes.get())
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
