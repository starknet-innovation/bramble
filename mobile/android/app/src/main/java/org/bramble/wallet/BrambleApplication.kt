package org.bramble.wallet

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import org.bramble.core.WalletCore

/** Owns the process-wide Rust core. Leaving the foreground ends the session. */
class BrambleApplication : Application() {
    lateinit var store: WalletStore
        private set

    override fun onCreate() {
        super.onCreate()
        // noBackupFilesDir: app-private, excluded from backup and device transfer.
        val core = WalletCore(noBackupFilesDir.resolve("vault").absolutePath)
        store = WalletStore(core, getSharedPreferences("bramble", MODE_PRIVATE))
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) = store.lock()
        })
    }
}
