package org.bramble.wallet

import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.NetworkId
import org.bramble.wallet.design.BrambleTheme
import org.bramble.wallet.portfolio.TokenDetailScreen
import org.bramble.wallet.staking.StakingCopy
import org.bramble.wallet.staking.StakingScreen
import org.bramble.wallet.staking.stakingRefusal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Staking (M21, iOS `StakingTests`), offline: the core's policy, not the app, decides where it
 * shows. On Sepolia the screen is the core's refusal and the STRK screen offers no Stake; on
 * Mainnet the Starkscan and chain reads fail offline into the core's own sentences and the paste
 * field refuses an address that is not one. The fixture node refuses every write.
 */
@RunWith(AndroidJUnit4::class)
class StakingTest {
    @get:Rule val rule = createComposeRule()

    private fun waitFor(matcher: SemanticsMatcher) =
        rule.waitUntil(TIMEOUT_MS) { rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }

    @Test
    fun sepoliaIsTheCoresRefusal() {
        val node = FixtureNode(deployed = true)
        openPublicWalletOn(node)
        // A fresh install starts on Mainnet (`NetworkPreference.fromStored`), so pick Sepolia here.
        onMainThread { switchNetwork(NetworkId.SEPOLIA) }
        assertEquals("Staking isn't available on this network.", stakingRefusal(NetworkId.SEPOLIA))
        assertFalse(onMainThread { stakingAvailable })
        val strk = onMainThread { portfolio.tracked.first { it.token.symbol == "STRK" }.token }
        rule.setContent {
            BrambleTheme { TokenDetailScreen(appStore, strk.id, back = {}, send = {}, journey = {}, stake = {}) }
        }
        waitFor(hasText("Send") and hasClickAction())
        assertTrue(rule.onAllNodes(hasText(StakingCopy.actionStake)).fetchSemanticsNodes().isEmpty())
        assertEquals(0, node.writes.get())
    }

    @Test
    fun mainnetRefusesEmptyAddress() {
        val node = FixtureNode(deployed = true)
        openPublicWalletOn(node)
        onMainThread { switchNetwork(NetworkId.MAINNET) }
        assertNull(stakingRefusal(NetworkId.MAINNET))
        assertTrue(onMainThread { stakingAvailable })
        rule.setContent { BrambleTheme { StakingScreen(appStore, viewActivity = {}, back = {}) } }
        waitFor(hasText("Couldn't load the validator list. Paste a validator address instead."))
        rule.onNode(hasText(StakingCopy.directoryOpen) and hasClickAction()).performClick()
        waitFor(hasText(StakingCopy.directoryInvalidAddress))
        assertEquals(0, node.writes.get())
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
