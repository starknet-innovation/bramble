package org.bramble.wallet.ui.wallet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import java.security.GeneralSecurityException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.DetailRow
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.SegmentedControl
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.securityCopy

/**
 * "Unlock & auto-lock", port of the iOS `SecurityView` (`docs/vault-security.md` §5): the
 * extension's settings-flow layout (flow header, eyebrow sections, a status line). Biometric
 * unlock is an Off/On segmented control, as Appearance uses, because the ui-kit has no switch.
 * Turning it on re-checks the passphrase in the core (throttled) and then shows the system
 * prompt; turning it off needs no key. Auto-lock is the extension's fixed policy, shown read-only,
 * with the Keystore's storage level while biometrics are on.
 */
@Composable
fun SecurityScreen(store: WalletStore, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    val activity = LocalContext.current
    val available = store.biometricsAvailable
    val enabled = store.security.biometricEnabled
    var choice by remember { mutableStateOf(enabled) }
    var confirming by remember { mutableStateOf(false) }
    var passphrase by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        store.refreshSecurity()
        choice = store.security.biometricEnabled
    }
    DisposableEffect(Unit) { onDispose { passphrase = "" } }

    fun select(on: Boolean) {
        choice = on
        when {
            on == store.security.biometricEnabled -> confirming = false
            on -> confirming = true
            else -> {
                store.disableBiometric()
                confirming = false
            }
        }
    }

    fun enable() {
        val attempt = passphrase
        passphrase = ""
        scope.launch {
            try {
                store.enableBiometric(activity, attempt)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (unavailable: GeneralSecurityException) {
                // The Keystore refused a biometric-bound key (for example, nothing enrolled).
                store.showToast(securityCopy(BrambleCopy.biometricUnavailable))
            } catch (error: Exception) {
                store.showError(error)
            }
            choice = store.security.biometricEnabled
            confirming = false
        }
    }

    val status = when {
        enabled -> securityCopy(BrambleCopy.biometricOnStatus)
        !available -> securityCopy(BrambleCopy.biometricUnavailable)
        else -> null
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader(BrambleCopy.securityTitle, subtitle = BrambleCopy.securitySubtitle, network = store.networkLabel, back = back)
        Eyebrow(BrambleCopy.biometricEyebrow)
        SegmentedControl(listOf("Off" to false, "On" to true), choice, enabled = available || enabled, onSelect = ::select)
        if (confirming) {
            BrambleField(label = "Confirm vault passphrase", placeholder = "", value = passphrase, onValueChange = { passphrase = it })
            PillButton(
                securityCopy(BrambleCopy.biometricEnable),
                icon = BrambleIconName.LOCK_KEYHOLE,
                busy = store.busy,
                enabled = passphrase.isNotEmpty() && store.retryRemainingMs() == 0L,
                onClick = ::enable,
            )
        }
        StatusLine(status, if (!available && !enabled) StatusTone.DANGER else StatusTone.MUTED)
        if (enabled) DetailRow(BrambleIconName.SHIELD, store.keyStorageLabel)
        Eyebrow(BrambleCopy.autoLockEyebrow, Modifier.padding(top = BrambleSpace.sm))
        DetailRow(BrambleIconName.LOCK_KEYHOLE, securityCopy(BrambleCopy.autoLockIdle))
        DetailRow(BrambleIconName.LOCK, BrambleCopy.autoLockBackground)
    }
}
