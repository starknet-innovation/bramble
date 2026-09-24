package org.bramble.wallet.security

import android.content.ContentResolver
import android.os.SystemClock
import android.provider.Settings
import org.bramble.core.HostClock

/**
 * The core's only time source (vault-security.md §4.4): `elapsedRealtime` keeps counting in deep
 * sleep and cannot be set by the user; `BOOT_COUNT` changes on every boot. There is no wall clock,
 * so changing the date cannot shorten a backoff delay or extend a session.
 */
class DeviceClock(resolver: ContentResolver) : HostClock {
    private val boot: String =
        runCatching { Settings.Global.getInt(resolver, Settings.Global.BOOT_COUNT).toString() }
            .getOrDefault("")

    override fun monotonicMs(): ULong = SystemClock.elapsedRealtime().toULong()

    override fun bootId(): String = boot
}
