package org.bramble.wallet

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import org.bramble.wallet.design.BrambleTheme
import org.bramble.wallet.ui.Root

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Blocks screenshots, screen recording, and the recents thumbnail for every screen:
        // the phrase, balances, and addresses never leave the device through the display.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        val store = (application as BrambleApplication).store
        setContent { BrambleTheme { Root(store) } }
    }
}
