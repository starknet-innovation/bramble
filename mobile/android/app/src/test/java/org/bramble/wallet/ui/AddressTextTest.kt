package org.bramble.wallet.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** The 6…4 short form the XCUITests look up, on the canonical addresses the core returns. */
class AddressTextTest {
    @Test
    fun shortensToSixAndFour() {
        assertEquals("0x2083…98d9", shortAddress("0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"))
    }

    @Test
    fun keepsShortValuesWhole() {
        assertEquals("0x0", shortAddress("0x0"))
        assertEquals("0x123456789abc", shortAddress("0x123456789abc"))
    }
}
