package org.bramble.wallet

import android.content.ClipboardManager
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * Accounts and groups, port of the iOS `AccountsTests` create story after onboarding (which
 * `OnboardingFlowTest` covers): the extension's nickname, the drawer's Add account, rename and
 * clear in Manage, then a group created there and the active account filed into it through the
 * drawer's folder picker. Runs on the offline [FixtureNode]; nothing is written to the chain. The
 * group's icon stays the default, and names are read from the store rather than the header.
 */
@RunWith(AndroidJUnit4::class)
class AccountsTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    /** The primary clip's text, read on the main thread while the app is in front. */
    private fun clipText(): String? {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        return clipboard.primaryClip
            ?.getItemAt(0)
            ?.text
            ?.toString()
    }

    private fun Robot.activeName(): String = onMain { activeRecord?.displayName }.orEmpty()

    @Test
    fun nameAddRenameAndGroup() {
        val node = FixtureNode(deployed = true)
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        openPublicWalletOn(node)
        r.waitForHome()
        val first = r.activeName()
        assertFalse("the extension's nickname, not $first", first.startsWith("Account"))
        assertEquals(2, first.split(" ").size)

        // Drawer: Add account makes the new account active.
        r.tapDescribed("Accounts")
        r.waitForText("Add account")
        assertFalse(
            "drawer rows carry no copy control",
            rule.onAllNodes(hasContentDescription("Copy", substring = true)).fetchSemanticsNodes().isNotEmpty(),
        )
        r.snapshot("drawer")
        r.tap("Add account")
        r.waitForText("Add a new account")
        r.expectToast("Account added") { r.tap("Regular account") }
        val second = r.activeName()
        assertNotEquals("the new account is active", first, second)

        // Manage: rename, then clear back to the nickname.
        r.tapDescribed("Accounts")
        r.tap("Manage accounts & groups")
        r.waitForText("Accounts & groups")
        r.typeSecret("Name", "Savings")
        r.expectToast("Label saved") { r.tap("Save name") }
        assertEquals("Savings", r.activeName())
        // API 33+ confirms a copy with the system's own notice, so check the clip itself: the full
        // public address of the active account (iOS checks its "Copied" toast instead).
        r.tapDescribed("Copy address")
        val address = r.onMain { activeRecord?.address }
        assertEquals(address, r.onMain { clipText() })
        r.typeSecret("Name", "")
        r.expectToast("Label cleared") { r.tap("Save name") }
        assertEquals("clearing the label restores the nickname", second, r.activeName())

        // Groups: create one, then file the active account through the drawer's folder picker.
        r.typeSecret("New group name", "Long term")
        r.expectToast("Group created") { r.tap("Create group") }
        r.tapDescribed("Back")
        r.tapDescribed("Accounts")
        rule.onAllNodes(hasText("Long term") and hasClickAction())[0].performClick()
        r.waitForText("No accounts in this group yet. Open an account's folder button to add it.")
        r.tap("All")
        r.tapDescribed("No folder — choose one for $second")
        r.waitFor(hasText("Long term") and hasClickAction())
        r.expectToast("Moved to folder") {
            rule.onAllNodes(hasText("Long term") and hasClickAction()).onLast().performClick()
        }
        r.waitFor(hasContentDescription("Folder: Long term for $second"))
        r.snapshot("drawer-grouped")
        assertEquals(0, node.writes.get())
    }
}
