package org.bramble.wallet

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.wallet.ui.shortAddress
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * Drives the real app through both first-run paths, step for step with the iOS
 * `OnboardingFlowTests`. The orchestrator clears app data before every test (the iOS "uninstall
 * first"), so each starts on the welcome step with no vault, on mainnet. Emulator only: never run
 * against a device that holds a real wallet. After "Open Bramble" the home screen reads public
 * balances from mainnet RPC, as the iOS suite does; no assertion depends on them, nothing is sent.
 */
@RunWith(AndroidJUnit4::class)
class OnboardingFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    @get:Rule val name = TestName()

    private fun robot(): Robot {
        val robot = Robot(rule, name.methodName)
        robot.waitForButton("Create a new wallet")
        return robot
    }

    @Test
    fun createBackupAndConfirm() {
        val r = robot()
        r.snapshot("welcome")
        r.tap("Create a new wallet")
        r.setPassphrase("Continue")
        r.reviewAndAdd(expectingShort = null)

        r.waitForText("Save your recovery phrase")
        r.snapshot("save-phrase-masked")
        rule.onNode(hasText("I saved my phrase") and hasClickAction()).assertIsNotEnabled()
        r.tap("Show recovery phrase")
        r.snapshot("save-phrase-revealed")
        // Words render in grid order after their position numbers.
        val words = (1..12).map { r.textOfTag("recovery-word-$it") }
        r.tap("I saved my phrase")

        r.waitForText("Confirm your backup")
        for (position in listOf(3, 7, 11)) r.typeSecret("Word $position", words[position - 1])
        r.waitForText("Backup confirmed.")
        r.snapshot("confirm-backup")
        r.tap("Continue")
        r.finishAndCheckHome()

        // Leave the device clean through the real removal path.
        r.tapDescribed("Settings")
        r.tap("Remove wallet from this device")
        r.typeSecret("Confirm vault passphrase", PublicWallet.PASSPHRASE)
        r.snapshot("remove-wallet")
        r.tap("Remove wallet")
        r.waitForButton("Create a new wallet")
    }

    @Test
    fun importOnMainnetThenLockAndUnlock() {
        val r = robot()
        r.tap("Add an existing wallet")
        r.waitForText("Choose how to add your wallet")
        r.snapshot("import-method")
        r.tap("Recovery phrase")
        // One word per cell, as a person types them.
        PublicWallet.PHRASE.split(" ").forEachIndexed { index, word -> r.typeSecret("Word ${index + 1}", word) }
        r.snapshot("recovery-phrase")
        r.tap("Continue")
        r.setPassphrase("Find your accounts")
        r.reviewAndAdd(expectingShort = shortAddress(PublicWallet.ADDRESS))
        r.finishAndCheckHome()

        r.tap("Receive")
        r.waitForButton("Copy address")
        r.snapshot("receive")
        r.tapDescribed("Back")

        r.tapDescribed("Settings")
        r.snapshot("settings")
        r.tap("Network")
        r.snapshot("network")
        r.tapDescribed("Back")
        r.tap("Appearance")
        r.tap("Light")
        r.snapshot("appearance-light")
        r.tap("Dark")
        r.tapDescribed("Back")

        r.tapDescribed("Accounts")
        r.waitForButton("Add account")
        assertTrue("the drawer lists the expected mainnet account", r.hasTextNow(shortAddress(PublicWallet.ADDRESS)))
        r.snapshot("accounts")
        r.tapDescribed("Close")

        r.tapDescribed("Lock wallet")
        r.waitForText("Welcome back")
        r.typeSecret("Enter your passphrase", "wrong passphrase")
        r.tap("Unlock")
        r.waitForText("Incorrect passphrase", 20_000)
        r.snapshot("unlock-failed")
        r.typeSecret("Enter your passphrase", PublicWallet.PASSPHRASE)
        r.tap("Unlock")
        r.waitForText("Account 1", 20_000)
    }
}
