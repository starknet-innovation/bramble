package org.bramble.wallet

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.bramble.core.SecurityStatus
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus

/**
 * Runs [WalletStore]'s core calls off the main thread under its lock epoch ([session]). A call
 * that a lock overtook fails as [SessionEndedException] whatever the core returned, after the core
 * is locked again and [relocked] has applied what that lock left (whether a vault now exists, and
 * the core's security state). Main-thread only, like the store that owns it.
 */
internal class CoreCalls(
    private val core: WalletCore,
    private val appScope: CoroutineScope,
    private val session: SessionGuard,
    private val relocked: (exists: Boolean, status: SecurityStatus) -> Unit,
) {
    /** True while a core call runs; the screens disable their actions on it. */
    var busy by mutableStateOf(false)
        private set

    /** The latest lock still running on `Dispatchers.Default`; the next call waits for it. */
    var pendingLock: Job? = null

    /** Runs one core call off the main thread, for the action holding [ticket]. */
    suspend fun <T> work(
        ticket: Long,
        body: () -> T,
    ): T {
        pendingLock?.join()
        busy = true
        try {
            var finished = false
            try {
                val result = withContext(Dispatchers.Default) { body() }
                finished = true
                ensureCurrent(ticket)
                return result
            } finally {
                // A call the lock overtook fails as a lock, whatever the core said (it refuses to
                // install a session after `lock()`, so a late unlock reports `Locked`).
                if (!finished) ensureCurrent(ticket)
            }
        } finally {
            busy = false
        }
    }

    /** Drops a result that arrived after a lock: re-locks the core, then fails the action. */
    private fun ensureCurrent(ticket: Long) {
        if (session.isCurrent(ticket)) return
        pendingLock =
            appScope.launch {
                val (exists, status) =
                    withContext(Dispatchers.Default) {
                        core.lock()
                        (core.status() != WalletStatus.NO_WALLET) to core.securityStatus()
                    }
                relocked(exists, status)
            }
        throw SessionEndedException()
    }
}
