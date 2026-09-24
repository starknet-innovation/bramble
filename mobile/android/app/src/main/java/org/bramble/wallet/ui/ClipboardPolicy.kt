package org.bramble.wallet.ui

/**
 * When Bramble may clear the address it put on the clipboard. Only the public address is ever
 * copied. Android 10+ lets an app read the clipboard only while it has focus, so the two-minute
 * expiry is best-effort: it runs on a timer while the app is in front, and otherwise the next
 * time the app regains focus. The clip is cleared only if it is still ours (same label and the
 * system timestamp recorded at copy time), so something the person copied since is never wiped.
 */
object ClipboardPolicy {
    const val LABEL = "Starknet address"
    const val EXPIRY_MS = 120_000L

    fun shouldClear(label: String?, stamp: Long?, ourStamp: Long?, copiedAt: Long?, now: Long): Boolean =
        label == LABEL && stamp != null && stamp == ourStamp && copiedAt != null && now - copiedAt >= EXPIRY_MS
}
