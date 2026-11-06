package org.bramble.wallet.ui

/**
 * When Bramble may clear what it put on the clipboard. Only public identifiers are ever copied
 * (address, signer public key, class hash; [AddressClipboard]), all under one [LABEL]. Android 10+
 * lets an app read the clipboard only while it has focus, so the two-minute expiry is best-effort:
 * it runs on a timer while the app is in front, and otherwise the next time the app regains focus.
 * The clip is cleared only if it is still ours (same label and the system timestamp recorded at
 * copy time), so something the person copied since is never wiped.
 */
object ClipboardPolicy {
    /** The clip label every Bramble copy carries; a clip with any other label is never cleared. */
    const val LABEL = "Starknet address"

    /** How long a copied value stays on the clipboard before Bramble clears it. */
    const val EXPIRY_MS = 120_000L

    /**
     * True when the current clip ([label], system [stamp]) is still the one Bramble wrote
     * ([ourStamp], recorded at [copiedAt]) and [EXPIRY_MS] has passed by [now]. Any missing value
     * means "not ours" or "unknown", so the answer is false and nothing is cleared.
     */
    fun shouldClear(
        label: String?,
        stamp: Long?,
        ourStamp: Long?,
        copiedAt: Long?,
        now: Long,
    ): Boolean = label == LABEL && stamp != null && stamp == ourStamp && copiedAt != null && now - copiedAt >= EXPIRY_MS
}
