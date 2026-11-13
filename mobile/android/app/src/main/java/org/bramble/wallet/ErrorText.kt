package org.bramble.wallet

import org.bramble.core.CoreException
import org.bramble.wallet.design.BrambleCopy
import java.util.Locale

/**
 * User-facing text for a core error, in the iOS (and extension) wording. Never includes user
 * input: only the core's fixed `InvalidInput` reasons are shown, and every other failure collapses
 * to one generic line.
 */
fun describe(error: Throwable): String =
    when (error) {
        is CoreException.WrongPassword -> BrambleCopy.incorrectPassphrase
        is CoreException.Throttled -> throttledText(error.retryAfterMs.toLong())
        is CoreException.BiometricInvalidated -> securityCopy(BrambleCopy.biometricInvalidated)
        is CoreException.InvalidInput -> error.reason.replaceFirstChar { it.uppercase() }
        is CoreException.WalletExists -> "A wallet already exists on this device"
        is CoreException.Locked -> "The wallet is locked"
        else -> "Something went wrong. Try again."
    }

/** "Too many attempts. Try again in 1:59." for a remaining delay, rounded up to the second. */
fun throttledText(ms: Long): String {
    val seconds = (ms + MILLIS_PER_SECOND - 1) / MILLIS_PER_SECOND
    val time =
        if (seconds >= SECONDS_PER_HOUR) {
            String.format(
                Locale.ROOT,
                "%d:%02d:%02d",
                seconds / SECONDS_PER_HOUR,
                seconds % SECONDS_PER_HOUR / SECONDS_PER_MINUTE,
                seconds % SECONDS_PER_MINUTE,
            )
        } else {
            String.format(Locale.ROOT, "%d:%02d", seconds / SECONDS_PER_MINUTE, seconds % SECONDS_PER_MINUTE)
        }
    return BrambleCopy.throttled.replace("{time}", time)
}

private const val MILLIS_PER_SECOND = 1_000L
private const val SECONDS_PER_MINUTE = 60L
private const val SECONDS_PER_HOUR = 3_600L

/** The idle-lock copy counts whole minutes. */
private const val MILLIS_PER_MINUTE = 60_000L

/** Android's name for its biometric, at the start of a sentence and inside one. */
private const val BIOMETRY = "Fingerprint"

/**
 * Fills the generated vault-security copy: `{biometry}` ("Fingerprint" when it opens the
 * sentence, "fingerprint" inside one, as "Unlock with fingerprint") and `{minutes}` (the idle
 * lock, from the generated constant).
 */
fun securityCopy(template: String): String {
    val biometry = if (template.startsWith("{biometry}")) BIOMETRY else BIOMETRY.lowercase()
    return template
        .replace("{biometry}", biometry)
        .replace("{minutes}", (BrambleCopy.idleLockMs / MILLIS_PER_MINUTE).toString())
}
