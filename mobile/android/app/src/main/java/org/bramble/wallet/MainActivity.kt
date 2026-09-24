package org.bramble.wallet

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.DisposableEffect
import org.bramble.wallet.design.BrambleTheme
import org.bramble.wallet.design.ThemeChoice
import org.bramble.wallet.ui.AddressClipboard
import org.bramble.wallet.ui.Root

/**
 * The single activity. Window-level protections (threats T1, T5, T6 in `docs/android-parity.md`):
 * `FLAG_SECURE` for every screen, autofill excluded for the whole hierarchy, touches dropped
 * while another window obscures this one, and non-system overlays hidden on API 31+.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Blocks screenshots, screen recording, and the recents thumbnail for every screen:
        // the phrase, balances, and addresses never leave the device through the display.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        // Android 13+: no Recents thumbnail at all, on top of FLAG_SECURE's blank one.
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) window.setHideOverlayWindows(true)
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        window.decorView.filterTouchesWhenObscured = true
        val store = (application as BrambleApplication).store
        setContent {
            val theme = store.theme
            DisposableEffect(theme) {
                val transparent = android.graphics.Color.TRANSPARENT
                val bars = if (theme == ThemeChoice.LIGHT) SystemBarStyle.light(transparent, transparent) else SystemBarStyle.dark(transparent)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
                onDispose {}
            }
            BrambleTheme(theme) { Root(store) }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Clipboard reads need focus from API 29, so an expired address clip is cleared here.
        if (hasFocus) AddressClipboard.clearIfExpired(this)
    }
}
