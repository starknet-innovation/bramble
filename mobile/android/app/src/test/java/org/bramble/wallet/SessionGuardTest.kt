package org.bramble.wallet

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A lock invalidates every ticket taken before it, and none taken after it. */
class SessionGuardTest {
    @Test
    fun aLockInvalidatesEarlierTickets() {
        val guard = SessionGuard()
        val before = guard.ticket()
        assertTrue(guard.isCurrent(before))
        guard.end()
        assertFalse("a result that lands after a lock is dropped", guard.isCurrent(before))
        val after = guard.ticket()
        assertTrue(guard.isCurrent(after))
        guard.end()
        guard.end()
        assertFalse(guard.isCurrent(after))
    }

    @Test
    fun sessionEndedIsACancellationSoItIsNeverShown() {
        assertTrue(SessionEndedException() is kotlinx.coroutines.CancellationException)
    }
}
