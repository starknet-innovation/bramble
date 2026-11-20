package org.bramble.wallet.send

import org.junit.Assert.assertEquals
import org.junit.Test

/** Half is the extension's `raw / 2n` on base units: floor division of a decimal string. */
class HalveTest {
    @Test
    fun halvesExactlyAndFloors() {
        assertEquals("62750000000000000000", halve("125500000000000000000"))
        assertEquals("0", halve("1"))
        assertEquals("1", halve("3"))
    }

    @Test
    fun refusesNonDigits() {
        assertEquals("0", halve("12a"))
        assertEquals("0", halve(""))
    }
}
