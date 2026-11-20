package org.bramble.wallet

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * Token management on the offline [FixtureNode], port of the iOS `PortfolioActivityTests`
 * manage-tokens story: hide STRK and see "1 not shown" on Home, show it again, add a token by
 * contract (its metadata read on chain), then find a held registry token and add it.
 */
@RunWith(AndroidJUnit4::class)
class TokenManagementTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    @Test
    fun hideShowAddAndDiscover() {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        openPublicWalletOn(FixtureNode(deployed = true, funded = true))
        r.waitForHome()
        val tracked = r.onMain { portfolio.tracked.size }

        r.tapDescribed("Portfolio actions")
        r.tap("Manage tokens")
        r.waitForText("$tracked tracked")
        r.tapDescribed("Hide STRK")
        r.waitFor(hasContentDescription("Show STRK"))
        r.snapshot("tokens")
        r.tapDescribed("Back")
        r.waitFor(hasText("1 not shown"), TIMEOUT_MS)
        r.tap("Manage tokens")
        r.tapDescribed("Show STRK")
        r.waitFor(hasContentDescription("Hide STRK"))

        r.tap("Add by contract")
        r.typeSecret("Contract address", FixtureNode.TEST_TOKEN)
        r.tap("Read and add token")
        r.waitFor(hasTestTag("tracked-TST"), TIMEOUT_MS)
        r.waitForText("${tracked + 1} tracked")

        // The add's "Token added" notice must be gone before the discover add is checked.
        rule.waitUntil(TIMEOUT_MS) { !r.hasTextNow("Token added") }
        r.tap("Find held tokens")
        r.tap("Scan for tokens")
        r.waitForText("1 found.", TIMEOUT_MS)
        r.snapshot("discover")
        r.expectToast("Token added", TIMEOUT_MS) { r.tapDescribed("Add USDC") }
        r.tapDescribed("Back")
        r.waitFor(hasTestTag("tracked-USDC"), TIMEOUT_MS)
        assertEquals(tracked + 2, r.onMain { portfolio.tracked.size })
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
