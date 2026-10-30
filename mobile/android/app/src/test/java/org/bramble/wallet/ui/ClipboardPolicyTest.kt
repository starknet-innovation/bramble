package org.bramble.wallet.ui

import org.bramble.wallet.ui.ClipboardPolicy.EXPIRY_MS
import org.bramble.wallet.ui.ClipboardPolicy.LABEL
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The clip is cleared only when it is still ours and has expired; nothing else is ever wiped. */
class ClipboardPolicyTest {
    private val stamp = 1_000L
    private val copiedAt = 50_000L

    @Test
    fun clearsOurClipOnceExpired() {
        assertTrue(ClipboardPolicy.shouldClear(LABEL, stamp, stamp, copiedAt, copiedAt + EXPIRY_MS))
    }

    @Test
    fun keepsOurClipBeforeExpiry() {
        assertFalse(ClipboardPolicy.shouldClear(LABEL, stamp, stamp, copiedAt, copiedAt + EXPIRY_MS - 1))
    }

    @Test
    fun neverClearsALaterClip() {
        assertFalse(ClipboardPolicy.shouldClear("Note", stamp + 1, stamp, copiedAt, copiedAt + EXPIRY_MS))
        assertFalse(ClipboardPolicy.shouldClear(LABEL, stamp + 1, stamp, copiedAt, copiedAt + EXPIRY_MS))
    }

    @Test
    fun doesNothingWithoutFocusOrACopy() {
        assertFalse(
            "no focus: the description reads as null",
            ClipboardPolicy.shouldClear(
                null,
                null,
                stamp,
                copiedAt,
                copiedAt + EXPIRY_MS,
            ),
        )
        assertFalse("never copied", ClipboardPolicy.shouldClear(LABEL, stamp, null, null, copiedAt + EXPIRY_MS))
    }
}
