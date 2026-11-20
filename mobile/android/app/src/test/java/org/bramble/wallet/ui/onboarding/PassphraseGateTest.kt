package org.bramble.wallet.ui.onboarding

import org.bramble.core.PassphraseLevel
import org.bramble.core.PassphraseStrength
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The passphrase step's gate after the extension dropped the weak-passphrase tick: a value the
 * vault accepts that matches its confirmation is enough, weak or not; the meter still names it.
 * The readings are the core's shapes (`passphrase_strength`), built here so no core call is needed.
 */
class PassphraseGateTest {
    private val weak = PassphraseStrength(PassphraseLevel.WEAK, WEAK_RATIO, "Weak", acceptable = true)
    private val tooShort = PassphraseStrength(PassphraseLevel.WEAK, SHORT_RATIO, "Enter at least 8 characters", false)
    private val strong = PassphraseStrength(PassphraseLevel.STRONG, 1.0, "Strong", acceptable = true)

    @Test
    fun weakButAcceptedNeedsNoTick() {
        assertTrue(PassphraseGate.ready(weak, "aaaaaaaa", "aaaaaaaa"))
        assertEquals("Weak · Passphrases match", PassphraseGate.status(weak, "aaaaaaaa", "aaaaaaaa"))
    }

    @Test
    fun refusedOrUnconfirmedIsNotReady() {
        assertFalse(PassphraseGate.ready(tooShort, "short", "short"))
        assertEquals("Enter at least 8 characters", PassphraseGate.status(tooShort, "short", "short"))
        assertFalse(PassphraseGate.ready(strong, "correct horse", ""))
        assertEquals("Strong", PassphraseGate.status(strong, "correct horse", ""))
    }

    @Test
    fun mismatchIsNamed() {
        assertFalse(PassphraseGate.ready(strong, "correct horse", "correct hose"))
        assertEquals("Passphrases do not match", PassphraseGate.status(strong, "correct horse", "correct hose"))
    }

    private companion object {
        const val WEAK_RATIO = 0.3
        const val SHORT_RATIO = 0.1
    }
}
