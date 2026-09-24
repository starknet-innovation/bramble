package org.bramble.wallet

import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.bramble.core.WalletStatus
import org.bramble.wallet.design.secretFieldTag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

/**
 * Threat T3: leaving the foreground ends the session, including when the lock lands while a
 * PBKDF2-bound core call (unlock, reveal, create) is still running. Whichever finishes first, the
 * app must end up locked with no phrase words held.
 */
@RunWith(AndroidJUnit4::class)
class LockOnBackgroundTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    @get:Rule val name = TestName()

    private fun robot() = Robot(rule, name.methodName).also { it.waitForButton("Create a new wallet") }

    /** Starts [action] on the main thread, waits until its core call is running, then locks. */
    private fun <T> lockWhileRunning(r: Robot, action: suspend WalletStore.() -> T): Result<T> {
        val running = r.store.appScope.async { runCatching { r.store.action() } }
        rule.waitUntil(5_000) { r.onMain { busy } || running.isCompleted }
        r.onMain { lock() } // what ProcessLifecycleOwner.onStop does
        return runBlocking { running.await() }
    }

    private fun assertEndedOrOvertaken(result: Result<*>) {
        val error = result.exceptionOrNull()
        assertTrue("only a lock may interrupt the call, got $error", error == null || error is SessionEndedException)
    }

    @Test
    fun pressingHomeLocksAndReturnsToUnlock() {
        val r = robot()
        r.importPublicWalletDirectly()
        r.waitForHome()
        rule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        rule.waitUntil(5_000) { r.onMain { route } == Route.LOCKED }
        r.awaitCoreStatus(WalletStatus.LOCKED)
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        r.waitForText("Welcome back")
    }

    @Test
    fun aLockDuringUnlockLeavesTheWalletLocked() {
        val r = robot()
        r.onMain { importWallet(PublicWallet.PHRASE, PublicWallet.PASSPHRASE); lock() }
        r.awaitCoreStatus(WalletStatus.LOCKED)
        assertEndedOrOvertaken(lockWhileRunning(r) { unlock(PublicWallet.PASSPHRASE) })
        r.awaitCoreStatus(WalletStatus.LOCKED)
        assertEquals(Route.LOCKED, r.onMain { route })
        r.waitForText("Welcome back")
    }

    @Test
    fun aLockDuringRevealDropsTheWords() {
        val r = robot()
        r.importPublicWalletDirectly()
        val result = lockWhileRunning(r) { revealPhrase(PublicWallet.PASSPHRASE) }
        assertEndedOrOvertaken(result)
        r.awaitCoreStatus(WalletStatus.LOCKED)
        assertEquals(Route.LOCKED, r.onMain { route })
        assertTrue(r.onMain { pendingBackup.isEmpty() })
    }

    @Test
    fun aLockDuringCreateDropsTheNewPhrase() {
        val r = robot()
        assertEndedOrOvertaken(lockWhileRunning(r) { create(PublicWallet.PASSPHRASE) })
        r.awaitCoreStatus(WalletStatus.LOCKED)
        assertTrue("no backup words survive the lock", r.onMain { pendingBackup.isEmpty() })
        // The vault was written, so the app goes to unlock rather than back to first run.
        rule.waitUntil(5_000) { r.onMain { route } == Route.LOCKED }
    }

    @Test
    fun backgroundingMidOnboardingKeepsThePhraseRecoverable() {
        val r = robot()
        r.onMain { create(PublicWallet.PASSPHRASE) }
        assertEquals(12, r.onMain { pendingBackup.size })
        rule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        rule.waitUntil(5_000) { r.onMain { route } == Route.LOCKED }
        assertTrue(r.onMain { pendingBackup.isEmpty() })
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        r.waitForText("Welcome back")
        r.onMain { unlock(PublicWallet.PASSPHRASE) }
        // The words were never confirmed, so Reveal secrets is the way back to them.
        assertEquals(12, r.onMain { revealPhrase(PublicWallet.PASSPHRASE).size })
    }

    @Test
    fun backgroundingBeforeAVaultExistsDropsTheTypedPhrase() {
        val r = robot()
        r.tap("Add an existing wallet")
        r.tap("Recovery phrase")
        r.typeSecret("Word 1", PublicWallet.PHRASE.split(" ").first())
        val before = r.onMain { onboardingGeneration }
        rule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        rule.waitUntil(5_000) { r.onMain { onboardingGeneration } == before + 1 }
        assertEquals(Route.ONBOARDING, r.onMain { route })
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        // The flow restarted at welcome: the recovery grid, and the word typed into it, are gone.
        r.waitForButton("Create a new wallet")
        assertTrue(rule.onAllNodes(hasTestTag(secretFieldTag("Word 1"))).fetchSemanticsNodes().isEmpty())
    }
}
