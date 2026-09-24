package org.bramble.wallet

import org.bramble.core.CoreException
import org.junit.Assert.assertEquals
import org.junit.Test

/** `describe` gives the iOS wording for every core error and never echoes anything else. */
class ErrorTextTest {
    @Test
    fun mapsEveryCoreErrorToTheIosWording() {
        assertEquals("Vault passphrase is incorrect", describe(CoreException.WrongPassword()))
        assertEquals("Invalid recovery phrase", describe(CoreException.InvalidInput("invalid recovery phrase")))
        assertEquals("A wallet already exists on this device", describe(CoreException.WalletExists()))
        assertEquals("The wallet is locked", describe(CoreException.Locked()))
        val generic = "Something went wrong. Try again."
        assertEquals(generic, describe(CoreException.NoWallet()))
        assertEquals(generic, describe(CoreException.Storage("remove vault")))
        assertEquals(generic, describe(CoreException.Kms("sign")))
        assertEquals(generic, describe(CoreException.Rpc("bad id")))
        assertEquals(generic, describe(IllegalStateException("typed secret words")))
    }
}
