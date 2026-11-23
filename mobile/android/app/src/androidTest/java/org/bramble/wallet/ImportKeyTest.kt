package org.bramble.wallet

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.withContentDescription
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * "Import private key" from the drawer's Add account, port of the iOS `ImportKeyTests`, on the
 * offline [FixtureNode] with the real core: an invalid key and a duplicate show the core's reason,
 * a valid key imports and becomes active, and the field is empty after every attempt and after
 * leaving. The orchestrator gives the test a fresh vault.
 *
 * The key is wallet-core's own test vector (`tests/key_import.rs`, `key_of(LEGAL, 0)`): the
 * published "legal winner" phrase's key at index 0, never a real wallet's. Snapshots are taken
 * only while the field is empty.
 */
@RunWith(AndroidJUnit4::class)
class ImportKeyTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    private fun Robot.activeName(): String = onMain { activeRecord?.displayName }.orEmpty()

    /** Drawer → Add account → Import an existing account → Private key. */
    private fun Robot.openImportKey(shoot: Boolean = false) {
        tapDescribed("Accounts")
        tap("Add account")
        tap("Import an existing account")
        waitForButton("Private key")
        if (shoot) snapshot("import-chooser")
        tap("Private key")
        waitForText("Import private key")
        if (shoot) snapshot("import-key-form")
    }

    private fun assertFieldEmpty() {
        onView(withContentDescription(FIELD)).check(matches(withText("")))
    }

    @Test
    fun invalidLeaveImportAndDuplicate() {
        val node = FixtureNode(deployed = true)
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        openPublicWalletOn(node)
        r.waitForHome()
        val first = r.activeName()

        r.openImportKey(shoot = true)
        r.typeSecret(FIELD, "0x0")
        r.expectToast("Invalid private key") { r.tap("Import account") }
        r.waitForText("Invalid private key")
        assertFieldEmpty()
        r.snapshot("import-key-invalid")

        // Leaving drops the key: back to the chooser and in again finds the field empty.
        r.typeSecret(FIELD, LEGAL_KEY)
        r.tapDescribed("Back")
        r.tap("Private key")
        assertFieldEmpty()

        // A valid key: the sheet closes on the new, active account, listed in the drawer.
        r.typeSecret(FIELD, LEGAL_KEY)
        r.expectToast("Account imported") { r.tap("Import account") }
        val imported = r.onMain { activeRecord }
        assertTrue("the record is marked imported", imported?.imported == true)
        assertEquals(LEGAL_PUBLIC_KEY, imported?.publicKey)
        assertNotEquals("the imported account is active", first, r.activeName())
        r.tapDescribed("Accounts")
        r.waitForText(r.activeName())
        r.waitForText(first)
        r.snapshot("drawer-imported")

        // The same key again is refused in the core's words, and the field is emptied.
        r.tap("Add account")
        r.tap("Import an existing account")
        r.tap("Private key")
        assertFieldEmpty()
        r.typeSecret(FIELD, LEGAL_KEY)
        r.expectToast("Account already exists") { r.tap("Import account") }
        assertFieldEmpty()
        assertEquals(imported?.id, r.onMain { activeRecord?.id })
        assertEquals(0, node.writes.get())
    }

    private companion object {
        const val FIELD = "Raw Starknet private key"
        const val LEGAL_KEY = "0x49ad2aeccec5cc04038494d378717b5ad1f42003d5507f840da0476eda6c3fc" // gitleaks:allow
        const val LEGAL_PUBLIC_KEY = "0xb7ff7bf7404503b6df17fa28ea02dd529e58ddd0cfb3232db83ef27630f6aa"
    }
}
