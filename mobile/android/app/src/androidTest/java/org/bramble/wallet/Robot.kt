package org.bramble.wallet

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.replaceText
import androidx.test.espresso.matcher.ViewMatchers.withContentDescription
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.bramble.core.AccountFamily
import org.bramble.core.RecoverySelection
import org.bramble.core.WalletStatus
import org.bramble.wallet.design.secretFieldTag
import java.io.File

/** The repository's published E2E wallet: public, never funded on purpose, safe in a test. */
object PublicWallet {
    const val PHRASE = "habit hope tip crystal because grunt nation idea electric witness alert like"
    const val ADDRESS = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"
    const val PASSPHRASE = "ui test passphrase"
}

typealias BrambleRule = AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

/**
 * Steps shared by the flow tests, named after the iOS XCUITest helpers. Compose finders drive
 * Compose UI; secret fields are platform `EditText`s inside `AndroidView`, so they are scrolled
 * into view through their Compose wrapper's test tag and typed into with Espresso, by the same
 * content description a screen reader hears.
 */
class Robot(
    private val rule: BrambleRule,
    private val testName: String,
    /** False for a real wallet: its screens (address, balances) are never written to disk. */
    private val snapshots: Boolean = true,
) {
    val store: WalletStore get() = (rule.activity.application as BrambleApplication).store

    private fun exists(matcher: SemanticsMatcher): Boolean = rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()

    fun waitFor(
        matcher: SemanticsMatcher,
        timeoutMs: Long = 10_000,
    ) = rule.waitUntil(timeoutMs) { exists(matcher) }

    fun waitForText(
        text: String,
        timeoutMs: Long = 10_000,
    ) = waitFor(hasText(text), timeoutMs)

    fun waitForButton(
        text: String,
        timeoutMs: Long = 10_000,
    ) = waitFor(hasText(text) and hasClickAction(), timeoutMs)

    fun hasTextNow(text: String): Boolean = exists(hasText(text))

    /** A button by its visible title; must exist, be enabled, and is scrolled into view first. */
    fun tap(
        text: String,
        timeoutMs: Long = 10_000,
    ) {
        val matcher = hasText(text) and hasClickAction()
        waitFor(matcher, timeoutMs)
        val node = rule.onAllNodes(matcher)[0]
        runCatching { node.performScrollTo() }
        node.assertIsEnabled().performClick()
        rule.waitForIdle()
    }

    /** An icon button or dock item by its content description. */
    fun tapDescribed(
        label: String,
        timeoutMs: Long = 10_000,
    ) {
        val matcher = hasContentDescription(label) and hasClickAction()
        waitFor(matcher, timeoutMs)
        rule.onAllNodes(matcher)[0].assertIsEnabled().performClick()
        rule.waitForIdle()
    }

    /** Types into the secret field labelled [label], replacing what it held. */
    fun typeSecret(
        label: String,
        text: String,
    ) {
        val tag = hasTestTag(secretFieldTag(label))
        waitFor(tag)
        runCatching { rule.onAllNodes(tag)[0].performScrollTo() }
        onView(withContentDescription(label)).perform(replaceText(text))
        rule.waitForIdle()
    }

    fun textOfTag(tag: String): String =
        rule
            .onAllNodes(
                hasTestTag(tag),
            )[0]
            .fetchSemanticsNode()
            .config[SemanticsProperties.Text]
            .joinToString("") { it.text }

    /** Runs [block] on the main thread, where the store lives. */
    fun <T> onMain(block: suspend WalletStore.() -> T): T =
        runBlocking { withContext(Dispatchers.Main) { store.block() } }

    fun awaitCoreStatus(
        expected: WalletStatus,
        timeoutMs: Long = 10_000,
    ) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (store.coreStatus() != expected) {
            check(
                System.currentTimeMillis() < deadline,
            ) { "core status stayed ${store.coreStatus()}, expected $expected" }
            Thread.sleep(20)
        }
    }

    /**
     * Saves a screenshot for design review, as the iOS `snapshot` attachments, into the directory
     * AGP collects as additional test output. Best-effort: a capture failure never fails a test.
     */
    fun snapshot(name: String) {
        if (!snapshots) return
        runCatching {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val dir = File(context.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
            val bitmap = rule.onRoot().captureToImage().asAndroidBitmap()
            File(dir, "$testName-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    // Flow steps shared by both first-run paths (iOS OnboardingFlowTests helpers).

    fun setPassphrase(cta: String) {
        typeSecret("Vault passphrase", PublicWallet.PASSPHRASE)
        typeSecret("Confirm passphrase", PublicWallet.PASSPHRASE)
        snapshot("passphrase")
        tap(cta)
    }

    fun reviewAndAdd(expectingShort: String?) {
        waitForText("Review your account", 20_000)
        if (expectingShort != null) waitForText(expectingShort, 20_000)
        snapshot("review-account")
        tap("Add selected account")
    }

    /**
     * "Find your accounts" after an import: waits for the search over the configured RPC endpoint,
     * makes sure the Bramble row with [expectingShort] is checked (an unfunded account is not
     * selected automatically), and restores. No acknowledgement: the selection alone gates it.
     */
    fun findAndRestore(expectingShort: String) {
        waitForText("Find your accounts", 20_000)
        waitFor(hasText("Search complete", substring = true), 120_000)
        snapshot("find-accounts")
        val row = hasText(expectingShort) and isToggleable()
        if (!exists(row)) tap("Bramble accounts")
        waitFor(row)
        val node = rule.onAllNodes(row)[0]
        runCatching { node.performScrollTo() }
        val state =
            node.fetchSemanticsNode().config.getOrElse(
                SemanticsProperties.ToggleableState,
            ) { ToggleableState.Off }
        if (state != ToggleableState.On) node.performClick()
        tap("Restore selected accounts")
    }

    /** The home screen, whose account name is the core's address-derived nickname. */
    fun waitForHome(timeoutMs: Long = 20_000) = waitForText("Tokens", timeoutMs)

    fun finishAndCheckHome() {
        waitForText("You’re all set", 20_000)
        snapshot("complete")
        tap("Open Bramble")
        waitForHome()
        snapshot("home")
    }

    /**
     * Lets a test reach the wallet without the UI flow: import (recovery pending, no accounts),
     * restore the Bramble account at index 0, then open the wallet.
     */
    fun importPublicWalletDirectly() {
        onMain {
            importWallet(PublicWallet.PHRASE, PublicWallet.PASSPHRASE)
            restoreRecoveredAccounts(listOf(RecoverySelection(AccountFamily.OPEN_ZEPPELIN, 0u, null)))
            finishOnboarding()
        }
    }
}
