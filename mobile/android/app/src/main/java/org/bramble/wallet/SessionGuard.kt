package org.bramble.wallet

import kotlinx.coroutines.CancellationException

/**
 * Lock epoch for the store. Core calls that take a password run PBKDF2 for about a second off
 * the main thread, and the core installs an unlocked session only when that finishes, so a lock
 * (for example the app going to the background) can land while a call is still running. Each
 * store action takes a [ticket] before its first core call; [end] (called by every lock) moves the
 * epoch on, and an action whose ticket is no longer [isCurrent] must drop its result (words,
 * accounts, a route change) and lock the core again instead of applying it.
 *
 * Main-thread only, like the store that owns it.
 */
class SessionGuard {
    private var epoch = 0L

    /** The current epoch, taken by an action before its first core call. */
    fun ticket(): Long = epoch

    /** True while no lock has ended the session since [ticket] was taken. */
    fun isCurrent(ticket: Long): Boolean = ticket == epoch

    /** Moves the epoch on (every lock), so every earlier ticket stops being current. */
    fun end() {
        epoch += 1
    }
}

/**
 * Thrown to the caller of a store action whose result arrived after a lock. It is a cancellation:
 * nothing is shown for it, and a coroutine that does not catch it simply ends.
 */
class SessionEndedException : CancellationException("the session ended while the call was running")
