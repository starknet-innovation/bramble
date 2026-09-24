package org.bramble.wallet.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleCopy
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.textStyle

/**
 * "Unlock & auto-lock" (vault-security.md §5), the Android twin of iOS `SecurityView`, using the
 * generated copy. UNCOMPILED: no Android SDK on the machine this was written on.
 */
@Composable
fun SecuritySettings(store: WalletStore) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var password by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun fill(text: String) = text.replace("{biometry}", "Fingerprint")
        .replace("{minutes}", (BrambleCopy.idleLockMs / 60_000).toString())
    Card {
        Text(BrambleCopy.securityTitle, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold), color = skin.text)
        Text(BrambleCopy.securitySubtitle, style = textStyle(BrambleTypeScale.caption), color = skin.muted)
        Text(BrambleCopy.biometricEyebrow.uppercase(), style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold), color = skin.muted)
        when {
            store.security.biometricEnabled -> {
                Text(fill(BrambleCopy.biometricOnStatus), style = textStyle(BrambleTypeScale.caption), color = skin.muted)
                SecondaryButton("Off") { store.disableBiometric() }
            }
            !store.biometricsAvailable ->
                Text(fill(BrambleCopy.biometricUnavailable), style = textStyle(BrambleTypeScale.caption), color = skin.danger)
            confirming -> {
                BrambleField("Confirm vault passphrase", password, { password = it }, secure = true)
                PrimaryButton(fill(BrambleCopy.biometricEnable), enabled = password.isNotEmpty(), busy = store.busy) {
                    scope.launch {
                        runCatching { store.enableBiometric(context, password) }
                            .onSuccess { password = ""; confirming = false; error = null }
                            .onFailure { error = describe(it) }
                    }
                }
            }
            else -> SecondaryButton("On") { confirming = true }
        }
        ErrorText(error)
        Text(store.keyStorageLabel, style = textStyle(BrambleTypeScale.caption), color = skin.muted)
        Text(BrambleCopy.autoLockEyebrow.uppercase(), style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold), color = skin.muted)
        Text(fill(BrambleCopy.autoLockIdle), style = textStyle(BrambleTypeScale.body), color = skin.text)
        Text(BrambleCopy.autoLockBackground, style = textStyle(BrambleTypeScale.body), color = skin.text)
    }
}
