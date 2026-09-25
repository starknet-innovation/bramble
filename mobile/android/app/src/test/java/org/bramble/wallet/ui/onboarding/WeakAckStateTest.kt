package org.bramble.wallet.ui.onboarding

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The extension's `weak-passphrase-ack.ts` behaviour: a tick is dropped only when the
 * acknowledgement stops applying, and asked for again if the value turns weak later.
 */
class WeakAckStateTest {
    @Test
    fun keepsATickWhileStillWeak() {
        assertTrue(WeakAck.sync(needs = true, ticked = true))
    }

    @Test
    fun dropsATickOnceTheValueImproves() {
        val afterImproving = WeakAck.sync(needs = false, ticked = true)
        assertFalse(afterImproving)
        // The value turns weak again: the earlier tick does not carry over.
        assertFalse(WeakAck.accepts(needs = true, ticked = WeakAck.sync(needs = true, ticked = afterImproving)))
    }

    @Test
    fun gatesOnlyWeakValues() {
        assertTrue(WeakAck.accepts(needs = false, ticked = false))
        assertFalse(WeakAck.accepts(needs = true, ticked = false))
        assertTrue(WeakAck.accepts(needs = true, ticked = true))
    }
}
