package org.bramble.wallet

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.MainScope
import org.bramble.core.WalletCore

/**
 * Owns the process-wide Rust core. Leaving the foreground ends the session: `store.lock()` wipes
 * UI state on the main thread and locks the core on a background dispatcher, and any core call
 * still running when that happens drops its result (see [SessionGuard]).
 */
class BrambleApplication : Application() {
    lateinit var store: WalletStore
        private set

    override fun onCreate() {
        super.onCreate()
        // noBackupFilesDir: app-private, excluded from backup and device transfer.
        val core = WalletCore(noBackupFilesDir.resolve("vault").absolutePath)
        store = WalletStore(core, getSharedPreferences("bramble", MODE_PRIVATE), MainScope())
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) = store.lock()
        })
    }
}
