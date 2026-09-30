package org.bramble.wallet

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.DeploymentState
import org.bramble.core.DetailAction
import org.bramble.core.tokenDetailPrivacy
import org.bramble.wallet.design.BrambleTheme
import org.bramble.wallet.portfolio.TokenDetailScreen
import org.bramble.wallet.privacy.PrivacyCopy
import org.bramble.wallet.privacy.tokenDetailPrivacyFor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Token detail (`tokenDetailFlow`, iOS `TokenDetailView`): price, balance, the token's Send,
 * contract receipt and the private-balance section. The section's action is the core's
 * `tokenDetailPrivacy` over the store's real deployment judgement: for the undeployed published
 * account it reads "Shield" and opens the journey, which names the prerequisite; an assumed
 * Unknown deployment would offer "Go private" instead.
 */
@RunWith(AndroidJUnit4::class)
class TokenDetailTest {
    @get:Rule val rule = createComposeRule()

    private fun waitFor(matcher: androidx.compose.ui.test.SemanticsMatcher) =
        rule.waitUntil(TIMEOUT_MS) { rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }

    @Test
    fun showsContractAndPrivateAction() {
        openPublicWalletOn(FixtureNode(deployed = false))
        val strk = onMainThread { portfolio.tracked.first { it.token.symbol == "STRK" }.token }
        rule.setContent {
            BrambleTheme { TokenDetailScreen(appStore, strk.id, back = {}, send = {}, journey = {}) }
        }
        waitFor(hasText("Your balance".uppercase()))
        waitFor(hasText("Contract".uppercase()))
        waitFor(hasText(strk.decimals.toString()))
        waitFor(hasContentDescription("Copy token address") and hasClickAction())
        waitFor(hasText("Send") and hasClickAction())

        val action = onMainThread { tokenDetailPrivacyFor(strk.address).action }
        assertEquals("an undeployed account is offered Shield, funded or not", DetailAction.SHIELD, action)
        waitFor(hasText(PrivacyCopy.detailShield) and hasClickAction())
        val assumed =
            onMainThread {
                tokenDetailPrivacy(network, DeploymentState.UNKNOWN, privacy.reading, strk.address, privacy.state)
            }
        assertNotEquals("the real deployment changes the answer", action, assumed.action)
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
