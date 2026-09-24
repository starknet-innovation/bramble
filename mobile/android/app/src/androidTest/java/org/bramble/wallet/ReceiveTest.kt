package org.bramble.wallet

import android.content.ClipboardManager
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.wallet.ui.ClipboardPolicy
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * Threat T7: Receive copies only the public address, labelled so the best-effort expiry can
 * recognise it later. (The expiry decision itself is covered by the JVM `ClipboardPolicyTest`;
 * Android lets an app read the clipboard only while focused, so it cannot be forced from here.)
 */
@RunWith(AndroidJUnit4::class)
class ReceiveTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    @get:Rule val name = TestName()

    @Test
    fun copyAddressPutsOnlyThePublicAddressOnTheClipboard() {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        r.importPublicWalletDirectly()
        r.tap("Receive")
        r.waitFor(hasContentDescription("QR code for your Starknet address"))
        r.tap("Copy address")
        r.waitForText("Copied")
        val clip = r.onMain {
            val clipboard = rule.activity.getSystemService(ClipboardManager::class.java)
            clipboard.primaryClip
        }
        val address = r.onMain { account?.address }
        assertEquals(ClipboardPolicy.LABEL, clip?.description?.label?.toString())
        assertEquals(address, clip?.getItemAt(0)?.text?.toString())
        assertEquals(PublicWallet.ADDRESS, address)
    }
}
