package org.bramble.wallet.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Copies the public address with [ClipboardPolicy]'s best-effort expiry. The address is public,
 * so the clip is not marked sensitive and Android 13+ shows its usual preview. Main-thread only.
 * Only the clip description (label, timestamp) is read back, never another app's clip content.
 */
object AddressClipboard {
    private var ourStamp: Long? = null
    private var copiedAt: Long? = null

    fun copy(context: Context, address: String, scope: CoroutineScope) {
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
        clipboard.setPrimaryClip(ClipData.newPlainText(ClipboardPolicy.LABEL, address))
        ourStamp = clipboard.primaryClipDescription?.timestamp
        copiedAt = SystemClock.elapsedRealtime()
        val app = context.applicationContext
        scope.launch {
            delay(ClipboardPolicy.EXPIRY_MS)
            clearIfExpired(app)
        }
    }

    fun clearIfExpired(context: Context) {
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
        val description = clipboard.primaryClipDescription
        val clear = ClipboardPolicy.shouldClear(
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
