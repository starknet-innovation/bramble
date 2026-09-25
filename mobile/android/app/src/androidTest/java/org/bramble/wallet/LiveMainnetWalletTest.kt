package org.bramble.wallet

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.bramble.wallet.ui.shortAddress
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * Opt-in import of a real (funded) wallet, the Android twin of the iOS suite's environment
 * override. Skipped unless both instrumentation arguments are given, and refused under CI: the
 * Gradle build passes `ci=true` whenever the host's `CI` variable is set. No screenshots are saved.
 *
 *   ./gradlew :app:connectedDebugAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=org.bramble.wallet.LiveMainnetWalletTest \
 *     -Pandroid.testInstrumentationRunnerArguments.BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" \
 *     -Pandroid.testInstrumentationRunnerArguments.BRAMBLE_MOBILE_MAINNET_ADDRESS=0x…
 *
 * It never sends a transaction and never prints the phrase, but instrumentation arguments reach
 * the Gradle command line and an Espresso failure dumps the view tree (phrase words included):
 * clear the shell history and delete `app/build/outputs/androidTest-results` after a real run.
 */
@RunWith(AndroidJUnit4::class)
class LiveMainnetWalletTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    @Test
    fun importsConfiguredMainnetWallet() {
        val args = InstrumentationRegistry.getArguments()
        val phrase = args.getString("BRAMBLE_MOBILE_MAINNET_MNEMONIC")
        val address = args.getString("BRAMBLE_MOBILE_MAINNET_ADDRESS")
        assumeTrue("live wallet not configured", !phrase.isNullOrBlank() && !address.isNullOrBlank())
        // `ci` is set by app/build.gradle.kts from the host's CI variable (see there).
        check(args.getString("ci") != "true") { "the live mainnet test never runs in CI" }

        val r = Robot(rule, name.methodName, snapshots = false)
        r.tap("Add an existing wallet")
        r.tap("Recovery phrase")
        val words = phrase!!.trim().split(Regex("\\s+"))
        // The toggle clears the grid, so it comes before any typing.
        if (words.size == 24) r.tap("Use a 24-word phrase")
        words.forEachIndexed { index, word -> r.typeSecret("Word ${index + 1}", word) }
        r.tap("Continue")
        r.setPassphrase("Find your accounts")
        r.findAndRestore(expectingShort = shortAddress(canonical(address!!)))
        r.finishAndCheckHome()
    }

    /** `0x` plus lowercase hex without leading zeros, as the core prints addresses. */
    private fun canonical(value: String): String = "0x" + value.lowercase().removePrefix("0x").trimStart('0')
}
