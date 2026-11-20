package org.bramble.wallet

import org.bramble.core.CoreException
import org.bramble.wallet.design.BrambleCopy
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `describe` gives the iOS wording for every core error and never echoes anything else; the
 * vault-security strings come from the generated copy.
 */
class ErrorTextTest {
    @Test
    fun mapsCoreErrorsToIosWording() {
        assertEquals("Incorrect passphrase", describe(CoreException.WrongPassword()))
        assertEquals("Invalid recovery phrase", describe(CoreException.InvalidInput("invalid recovery phrase")))
        assertEquals("A wallet already exists on this device", describe(CoreException.WalletExists()))
        assertEquals("The wallet is locked", describe(CoreException.Locked()))
        val generic = "Something went wrong. Try again."
        assertEquals(generic, describe(CoreException.NoWallet()))
        assertEquals(generic, describe(CoreException.Storage("remove vault")))
        assertEquals(generic, describe(CoreException.Kms("sign")))
        assertEquals(generic, describe(CoreException.Rpc("bad id")))
        assertEquals(generic, describe(CoreException.BiometricUnavailable()))
        assertEquals(generic, describe(IllegalStateException("typed secret words")))
    }

    @Test
    fun throttleShowsMinutesAndSeconds() {
        assertEquals("Too many attempts. Try again in 0:30.", describe(CoreException.Throttled(30_000uL)))
        assertEquals("Too many attempts. Try again in 1:59.", throttledText(118_001))
        assertEquals("Too many attempts. Try again in 1:00:00.", throttledText(3_600_000))
    }

    @Test
    fun namesFingerprintAndIdleWindow() {
        assertEquals(
            "Fingerprint changed on this device. Enter your passphrase, then turn it on again in Security.",
            describe(CoreException.BiometricInvalidated()),
        )
        assertEquals("Unlock with fingerprint", securityCopy(BrambleCopy.unlockWithBiometry))
        assertEquals("After 30 minutes idle", securityCopy(BrambleCopy.autoLockIdle))
    }
}
