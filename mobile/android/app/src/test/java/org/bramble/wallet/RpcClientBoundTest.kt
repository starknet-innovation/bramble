package org.bramble.wallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException

/** A response body is read up to the cap and refused beyond it, before the core sees it. */
class RpcClientBoundTest {
    private val max = RpcClient.MAX_RESPONSE_BYTES

    @Test
    fun readsABodyAtTheCap() {
        val body = "a".repeat(max)
        assertEquals(body, RpcClient.readBounded(ByteArrayInputStream(body.toByteArray()), max))
    }

    @Test
    fun refusesOneByteOverTheCap() {
        val body = ByteArray(max + 1) { 'a'.code.toByte() }
        assertThrows(IOException::class.java) { RpcClient.readBounded(ByteArrayInputStream(body), max) }
    }

    @Test
    fun capIs64KiB() {
        assertEquals(64 * 1024, max)
    }
}
