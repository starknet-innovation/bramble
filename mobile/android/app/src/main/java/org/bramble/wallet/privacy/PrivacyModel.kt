package org.bramble.wallet.privacy

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.bramble.core.NetworkInfo
import org.bramble.core.PrivacyReading
import org.bramble.core.PrivacyState
import org.bramble.core.PrivacyStep
import org.bramble.core.WalletCore
import org.bramble.core.privacyConfigured

/**
 * The selected account's private-balance reading, mirroring the iOS `PrivacyModel`: public
 * results only (registration, per-token totals, pool fee). Kotlin never derives or reads the
 * viewing key, but it crosses FFI once per discovery request inside the opaque `Post` body, which
 * [PrivacyDriver] sends and then zeroes (docs/privacy.md §1.1, §5: the exemption awaiting
 * sign-off). Nothing is persisted. [reset] runs on lock, account switch and network switch, a read
 * that finishes after a reset is dropped, and the core ignores a reading from another network.
 *
 * Uncompiled: this machine has no Android SDK; written against the generated Kotlin bindings.
 */
class PrivacyModel {
    var reading by mutableStateOf<PrivacyReading>(PrivacyReading.Idle)
        private set
    var state by mutableStateOf<PrivacyState?>(null)
        private set
    private var generation = 0
    private var plan: org.bramble.core.PrivacyReadPlan? = null
    private var scope: Pair<org.bramble.core.NetworkId, UInt>? = null

    /** Forgets the reading unless it belongs to this network and account. */
    fun retain(network: org.bramble.core.NetworkId, accountIndex: UInt?) {
        if (accountIndex == null || scope != Pair(network, accountIndex)) reset()
    }

    fun reset() {
        plan?.close()
        plan = null
        generation += 1
        reading = PrivacyReading.Idle
        state = null
        scope = null
    }

    /** Reads one account's private balances; an unrouted network settles as `Unconfigured`. */
    suspend fun refresh(core: WalletCore, network: NetworkInfo, accountIndex: UInt) {
        reset()
        val scope = generation
        this.scope = Pair(network.network, accountIndex)
        if (!privacyConfigured(network.network)) {
            reading = PrivacyReading.Unconfigured
            return
        }
        val prepared = runCatching { core.preparePrivacyRead(network.network, accountIndex) }.getOrNull()
        if (prepared == null) {
            reading = PrivacyReading.Failed
            return
        }
        plan = prepared
        reading = PrivacyReading.Loading
        val step = runCatching { PrivacyDriver(prepared, network).run() }.getOrNull()
        if (scope != generation) return
        plan = null
        if (step is PrivacyStep.Finished) {
            state = step.state
            reading = PrivacyReading.Settled(step.state.registration)
        } else {
            reading = PrivacyReading.Failed
        }
    }
}
