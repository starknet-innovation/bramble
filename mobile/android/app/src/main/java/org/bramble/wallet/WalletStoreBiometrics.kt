package org.bramble.wallet

import android.content.Context
import kotlinx.coroutines.CancellationException
import org.bramble.core.BiometricDomain
import org.bramble.core.CoreException
import org.bramble.core.InternalException
import org.bramble.core.WalletStatus
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.security.BiometricVault

// The biometric slot of [WalletStore] (docs/vault-security.md §2.4), split from WalletStore.kt by
// behaviour. The wrap secret passes through only inside [unlockWithBiometric] and
// [enableBiometric], and is zero-filled before they return. Main-thread only, like the store.

/**
 * Each time the app comes to the foreground: tidy up after a removed wallet, drop the slot if
 * the Keystore key was invalidated by an enrolment change, and apply the idle lock. Android
 * has no domain-state API, so reconciling reports `Unavailable`, which never drops a slot.
 */
fun WalletStore.onForeground() {
    if (walletCore.status() == WalletStatus.NO_WALLET) {
        biometrics.delete()
        return
    }
    refreshSecurity()
    try {
        walletCore.reconcileBiometricDomain(BiometricDomain.Unavailable)
    } catch (ignored: CoreException.BiometricInvalidated) {
        invalidateBiometric()
    } catch (ignored: CoreException) {
    }
    if (security.biometricEnabled && biometrics.invalidated()) invalidateBiometric()
    if (route.unlocked && walletCore.status() != WalletStatus.UNLOCKED) lock()
    refreshSecurity()
}

/** A real enrolment change: the core locks and drops the slot, the Keystore key goes too. */
private fun WalletStore.invalidateBiometric() {
    runCatching { walletCore.biometricInvalidated() }
    biometrics.delete()
    biometricNotice = securityCopy(BrambleCopy.biometricInvalidated)
    lock()
}

/**
 * Prompts for a strong biometric and unlocks with the released wrap secret. A non-match,
 * cancel or lockout returns quietly so the passphrase stays available, and keeps the slot.
 * Other failures show as a toast; a lock during the prompt wins ([SessionGuard]).
 */
suspend fun WalletStore.unlockWithBiometric(activity: Context) {
    refreshSecurity()
    if (!security.biometricEnabled || busy) return
    val ticket = session.ticket()
    val read =
        try {
            biometrics.read(activity, BrambleCopy.biometricPromptReason)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (ignored: Exception) {
            BiometricVault.Read.Fallback
        }
    when (read) {
        BiometricVault.Read.Fallback -> {
            // Non-match, cancel or lockout: the passphrase stays available and the slot is kept.
        }

        BiometricVault.Read.Invalidated -> {
            invalidateBiometric()
        }

        is BiometricVault.Read.Secret -> {
            if (unlockWithSecret(read.bytes, ticket)) {
                biometricNotice = null
                refreshSecurity()
                enterWallet(ticket)
            }
        }
    }
}

/**
 * Hands the released wrap [secret] to the core while [ticket] is current; true when the vault
 * unlocked. An invalidated slot is dropped and other core failures show as a toast. The
 * secret is zero-filled before this returns, whatever happened.
 */
private suspend fun WalletStore.unlockWithSecret(
    secret: ByteArray,
    ticket: Long,
): Boolean =
    try {
        if (session.isCurrent(ticket)) {
            calls.work(ticket) { walletCore.unlockWithBiometric(secret) }
            true
        } else {
            false
        }
    } catch (ignored: CoreException.BiometricInvalidated) {
        invalidateBiometric()
        false
    } catch (error: CoreException) {
        showError(error)
        false
    } catch (error: InternalException) {
        showError(error)
        false
    } finally {
        secret.fill(0)
    }

/**
 * Stores a fresh wrap secret behind a biometric-bound Keystore key (after a prompt), then has
 * the core re-check [password] (throttled and counted) and add the slot. Returns false when
 * the person cancelled the prompt. The secret is zero-filled before this returns.
 */
suspend fun WalletStore.enableBiometric(
    activity: Context,
    password: String,
): Boolean {
    val ticket = session.ticket()
    val secret = biometrics.newWrapSecret()
    try {
        if (!biometrics.store(activity, secret, BrambleCopy.biometricPromptReason)) return false
        addSlot(ticket, password, secret)
    } finally {
        secret.fill(0)
        refreshSecurity()
    }
    scheduleIdleLock()
    return true
}

/**
 * Has the core re-check [password] and add the slot for [secret]. On any failure the new Keystore
 * key is kept only if the core holds a slot for it (a lock can overtake a success), and the
 * failure propagates unchanged.
 */
private suspend fun WalletStore.addSlot(
    ticket: Long,
    password: String,
    secret: ByteArray,
) {
    var enabled = false
    try {
        calls.work(ticket) { walletCore.enableBiometricUnlock(password, secret, null) }
        enabled = true
    } finally {
        if (!enabled) {
            refreshSecurity()
            if (!security.biometricEnabled) biometrics.delete()
        }
    }
}

/** Removes the slot; needs no key, so it works in any state. */
fun WalletStore.disableBiometric() {
    runCatching { walletCore.disableBiometricUnlock() }
    biometrics.delete()
    refreshSecurity()
}
