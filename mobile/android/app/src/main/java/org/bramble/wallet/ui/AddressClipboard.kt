package org.bramble.wallet.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The app's one clipboard writer (SCOPE.md "Clipboard", `docs/accounts.md` §2.8): public
 * identifiers only (an account address, a signer public key, a class hash), never the phrase or a
 * key, always the full value, with [ClipboardPolicy]'s best-effort expiry. They are public, so the
 * clip is not marked sensitive and Android 13+ shows its usual preview. Main-thread only. Only the
 * clip description (label, timestamp) is read back, never another app's clip content.
 */
object AddressClipboard {
    private var ourStamp: Long? = null
    private var copiedAt: Long? = null

    /** Copies [value]; false when the clipboard is unavailable or refused the clip ("Copy failed"). */
    fun copy(
        context: Context,
        value: String,
        scope: CoroutineScope,
    ): Boolean {
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return false
        val copied =
            try {
                clipboard.setPrimaryClip(ClipData.newPlainText(ClipboardPolicy.LABEL, value))
                true
            } catch (ignored: RuntimeException) {
                // Any refusal from the clipboard service (not focused, or it died) is "Copy failed".
                false
            }
        if (copied) {
            ourStamp = clipboard.primaryClipDescription?.timestamp
            copiedAt = SystemClock.elapsedRealtime()
            val app = context.applicationContext
            scope.launch {
                delay(ClipboardPolicy.EXPIRY_MS)
                clearIfExpired(app)
            }
        }
        return copied
    }

    /**
     * Clears the clipboard if it still holds our clip and [ClipboardPolicy.EXPIRY_MS] has passed
     * since the copy; otherwise leaves it untouched. Does nothing when the clipboard is unavailable.
     */
    fun clearIfExpired(context: Context) {
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
        val description = clipboard.primaryClipDescription
        val clear =
            ClipboardPolicy.shouldClear(
                description?.label?.toString(),
                description?.timestamp,
                ourStamp,
                copiedAt,
                SystemClock.elapsedRealtime(),
            )
        if (clear) {
            clipboard.clearPrimaryClip()
            ourStamp = null
            copiedAt = null
        }
    }
}
