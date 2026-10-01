package org.bramble.wallet.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.accountLabel
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The app's one short-address helper is the core's `accountLabel` (the extension's 6…4 rule with
 * U+2026), on the canonical addresses the core returns. Instrumented, not a JVM unit test: it calls
 * the native core, which the host JVM cannot load.
 */
@RunWith(AndroidJUnit4::class)
class AddressTextTest {
    @Test
    fun shortensToSixAndFour() {
        assertEquals("0x2083…98d9", accountLabel("0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"))
    }

    @Test
    fun sameRuleForShortValues() {
        assertEquals("0x0…0x0", accountLabel("0x0"))
    }

    @Test
    fun shortAddressIsTheCoreRule() {
        val address = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"
        assertEquals(accountLabel(address), shortAddress(address))
        assertEquals(accountLabel("0x0"), shortAddress("0x0"))
    }
}
