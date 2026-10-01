package org.bramble.wallet

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.MainScope
import org.bramble.core.WalletCore
import org.bramble.wallet.security.BiometricVault
import org.bramble.wallet.security.DeviceClock

/**
 * Owns the process-wide Rust core, which reads time only from the monotonic [DeviceClock]. Leaving
 * the foreground ends the session: `store.lock()` wipes UI state on the main thread and locks the
 * core on a background dispatcher, and any core call still running when that happens drops its
 * result (see [SessionGuard]). Coming back re-checks the biometric key and the idle deadline.
 */
class BrambleApplication : Application() {
    /**
     * The process-wide store, built on the main thread by [onCreate] before any activity reads it.
     * The vault lives in `noBackupFilesDir`: app-private, excluded from backup and device transfer.
     */
    val store: WalletStore by lazy {
        val core = WalletCore(noBackupFilesDir.resolve("vault").absolutePath, DeviceClock(contentResolver))
        WalletStore(
            core,
            getSharedPreferences("bramble", MODE_PRIVATE),
            BiometricVault(this),
            MainScope(),
            noBackupFilesDir.resolve("portfolio"),
        )
    }

    override fun onCreate() {
        super.onCreate()
        val walletStore = store
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStop(owner: LifecycleOwner) = walletStore.lock()

                override fun onStart(owner: LifecycleOwner) = walletStore.onForeground()
            },
        )
    }
}
