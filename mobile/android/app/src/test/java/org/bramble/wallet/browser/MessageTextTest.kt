package org.bramble.wallet.browser

import androidx.webkit.WebMessageCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The bridge reads a page message only as text: `getData` throws for an array buffer. */
class MessageTextTest {
    @Test
    fun arrayBufferIsRefused() {
        assertNull(messageText(WebMessageCompat(byteArrayOf(1))))
    }

    @Test
    fun textIsRead() {
        assertEquals("{}", messageText(WebMessageCompat("{}")))
    }
}
