package org.bramble.wallet

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.bramble.core.NetworkId
import org.bramble.core.RevokeException
import org.bramble.wallet.allowances.AllowanceCopy
import org.bramble.wallet.allowances.AllowancesScreen
import org.bramble.wallet.allowances.RevokeFlowModel
import org.bramble.wallet.design.BrambleTheme
import org.bramble.wallet.send.SendCopy
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The allowance manager (`allowancesFlow`, iOS `AllowancesView`) on the offline [FixtureNode]: a
 * grant the wallet filed is listed with its spender and a Revoke control; Revoke opens the core's
 * review of `approve(spender, 0)` with its fee before anything is signed, and the one Revoke press
 * hands one signed write to the node. The node refuses it, so nothing is reported submitted.
 */
@RunWith(AndroidJUnit4::class)
class AllowancesTest {
    @get:Rule val rule = createComposeRule()

    private fun waitFor(text: String) =
        rule.waitUntil(
            TIMEOUT_MS,
        ) { rule.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty() }

    private fun showing(text: String): Boolean = rule.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()

    /**
     * Files one 1000-unit STRK grant to [SPENDER] by the active account on the store's network
     * (Mainnet by default, as the listing reads it; a Sepolia record would never be listed).
     */
    private fun seed(): String {
        val (owner, network) = onMainThread { activeRecord?.id.orEmpty() to network }
        val id = "$owner:$STRK:$SPENDER"
        val record =
            JSONObject()
                .put("accountId", owner)
                .put("amount", "1000")
                .put("id", id)
                .put("networkId", if (network == NetworkId.SEPOLIA) "SN_SEPOLIA" else "SN_MAIN")
                .put("spender", SPENDER)
                .put("token", STRK)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.noBackupFilesDir.resolve("vault/allowances.v1.json").writeText(JSONArray().put(record).toString())
        return id
    }

    /**
     * A refusal reads in the core's words (`RevokeError`'s `Display`, native since wallet-core
     * v0.9.0, so not a JVM test) through the extension's friendly copy.
     */
    @Test
    fun aRefusalReadsInTheCoresWords() {
        assertEquals(
            "That's an NFT contract, not a token. Revoke it from the site that asked.",
            RevokeFlowModel.shown(RevokeException.Collection()),
        )
        assertEquals(
            "Couldn't confirm that contract is a token, so the revoke wasn't sent. Revoke it from the site that asked.",
            RevokeFlowModel.shown(RevokeException.UnconfirmedToken()),
        )
    }

    @Test
    fun revokeIsReviewedThenPostedOnce() {
        val node = FixtureNode(deployed = true, funded = true)
        openPublicWalletOn(node)
        val id = seed()
        rule.setContent { BrambleTheme { AllowancesScreen(appStore, viewActivity = {}) {} } }
        rule.waitUntil(TIMEOUT_MS) { rule.onAllNodes(hasTestTag("revoke-$id")).fetchSemanticsNodes().isNotEmpty() }
        assertFalse(showing(AllowanceCopy.noneFound))
        rule.onNode(hasTestTag("revoke-$id")).performClick()

        // No second press: the review, with its fee, is fetched as the screen opens.
        rule.waitUntil(TIMEOUT_MS) { rule.onAllNodes(hasTestTag("revoke-summary")).fetchSemanticsNodes().isNotEmpty() }
        waitFor(SendCopy.feePrefix)
        assertEquals("nothing is written before Revoke", 0, node.writes.get())

        rule.onNode(hasTestTag("revoke-confirm") and hasClickAction()).performClick()
        rule.waitUntil(TIMEOUT_MS) { node.writes.get() == 1 && showing(SendCopy.back) }
        assertEquals("the signed revoke is posted exactly once", 1, node.writes.get())
        assertFalse("a refused revoke is never reported submitted", showing(AllowanceCopy.submitted))
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L

        /** STRK as the log and the ids spell it (`canonicalFelt`: unpadded). */
        const val STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
        const val SPENDER = "0x41fd22b238fa21cfcf5dd45a8548974d8263b3a531a60388411c5e230f97023"
    }
}
