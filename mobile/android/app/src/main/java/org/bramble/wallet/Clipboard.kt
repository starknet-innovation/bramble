package org.bramble.wallet

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import java.util.UUID

/**
 * The one way the app writes to the clipboard (SCOPE.md, "Clipboard"): public identifiers only
 * (an address, a signer public key, a class hash), never the phrase or a key. Android has no
 * expiring clip, so the app clears its own clip after two minutes, and only if the clip is still
 * the one it wrote (matched by a per-copy label nonce). UNCOMPILED (no Android SDK here).
 */
object Clipboard {
    const val LIFETIME_MS = 120_000L
    private val main = Handler(Looper.getMainLooper())

    /** Copies the full value. Returns true when the platform shows its own copy confirmation. */
    fun copy(context: Context, value: String): Boolean {
        val manager = context.getSystemService(ClipboardManager::class.java) ?: return false
        val nonce = "bramble-" + UUID.randomUUID()
        val clip = ClipData.newPlainText(nonce, value)
        // Public data, but never offered to keyboard or clipboard-history suggestions.
        clip.description.extras = PersistableBundle().apply {
            putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
        }
        manager.setPrimaryClip(clip)
        main.postDelayed({
            if (manager.primaryClipDescription?.label == nonce) manager.clearPrimaryClip()
        }, LIFETIME_MS)
        // API 33+ shows a system copy confirmation, so the app shows no toast of its own there.
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    }
}
