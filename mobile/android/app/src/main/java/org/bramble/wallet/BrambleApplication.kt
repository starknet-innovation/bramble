package org.bramble.wallet

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import org.bramble.core.WalletCore
import org.bramble.wallet.security.BiometricVault
import org.bramble.wallet.security.DeviceClock

/** Owns the process-wide Rust core. Leaving the foreground ends the session. */
class BrambleApplication : Application() {
    lateinit var store: WalletStore
        private set

    override fun onCreate() {
        super.onCreate()
        // noBackupFilesDir: app-private, excluded from backup and device transfer.
        val core = WalletCore(noBackupFilesDir.resolve("vault").absolutePath, DeviceClock(contentResolver))
        store = WalletStore(core, getSharedPreferences("bramble", MODE_PRIVATE), BiometricVault(this))
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) = store.lock()
            override fun onStart(owner: LifecycleOwner) = store.onForeground()
        })
    }
}
