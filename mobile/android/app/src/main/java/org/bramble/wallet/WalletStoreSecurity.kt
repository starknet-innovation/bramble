package org.bramble.wallet

import android.os.SystemClock
import org.bramble.core.SecurityStatus
import org.bramble.core.WalletStatus

// The passphrase paths of [WalletStore] (docs/vault-security.md), split from WalletStore.kt by
// behaviour: unlock, reveal, removal, and the mirror of the core's lock and backoff state. The
// core enforces backoff and the idle lock itself; these only mirror it. Main-thread only.

/** One throttled, counted passphrase attempt in the core; the countdown is refreshed either way. */
suspend fun WalletStore.unlock(password: String) {
    val ticket = session.ticket()
    try {
        calls.work(ticket) { walletCore.unlock(password) }
    } finally {
        refreshSecurity()
    }
    biometricNotice = null
    // A backup still owed resumes at Save phrase with the words revealed by this same, just-checked
    // passphrase; if that reveal fails, the backup step asks for it again.
    if (calls.work(ticket) { walletCore.backupPending() }) {
        pendingBackup = runCatching { revealPhrase(password) }.getOrDefault(emptyList())
    }
    enterWallet(ticket)
}

/**
 * Re-checks the password in the core (throttled; biometrics never reveal) and returns the
 * phrase for display only.
 */
suspend fun WalletStore.revealPhrase(password: String): List<String> {
    val ticket = session.ticket()
    val words =
        try {
            calls.work(ticket) { walletCore.revealRecoveryPhrase(password) }.words
        } finally {
            refreshSecurity()
        }
    scheduleIdleLock()
    return words
}

/**
 * Removes the vault after the core re-checks [password] (throttled), then the biometric key,
 * the session and the portfolio caches. Throws the core's error; nothing is removed then.
 */
suspend fun WalletStore.deleteWallet(password: String) {
    val ticket = session.ticket()
    try {
        calls.work(ticket) { walletCore.deleteWallet(password) }
    } finally {
        refreshSecurity()
    }
    vaultWritten = false
    biometrics.delete()
    lock()
    portfolio.deleteFiles()
}

/** Re-reads the core's security state. Passive: never renews the idle window. */
fun WalletStore.refreshSecurity() = applySecurity(walletCore.securityStatus())

/** Mirrors [status] into [WalletStore.security] and the retry deadline on `elapsedRealtime`. */
internal fun WalletStore.applySecurity(status: SecurityStatus) {
    security = status
    val retry = status.retryAfterMs.toLong()
    retryAtElapsedMs = if (retry > 0) SystemClock.elapsedRealtime() + retry else 0L
}

/** Milliseconds until a passphrase attempt is allowed, for countdowns; 0 when it is now. */
fun WalletStore.retryRemainingMs(now: Long = SystemClock.elapsedRealtime()): Long =
    (retryAtElapsedMs - now).coerceAtLeast(0L)

/** The core's wallet status, for tests and diagnostics; takes the session mutex. */
internal fun WalletStore.coreStatus(): WalletStatus = walletCore.status()
