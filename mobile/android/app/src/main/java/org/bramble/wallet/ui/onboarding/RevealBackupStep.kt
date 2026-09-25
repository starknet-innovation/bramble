package org.bramble.wallet.ui.onboarding

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.PillButton

/**
 * Port of the iOS `RevealBackupStep`: a backup still pending after an unlock that did not reveal
 * the words (a biometric unlock). The passphrase is checked again by the core's
 * `revealRecoveryPhrase`, as the side panel's reveal-software flow asks, before Save phrase shows
 * the words; [submit] reveals and moves on, and a failure is shown as the store's error toast.
 */
@Composable
fun RevealBackupStep(
    store: WalletStore,
    submit: suspend (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var passphrase by remember { mutableStateOf("") }
    DisposableEffect(Unit) { onDispose { passphrase = "" } }
    OnboardingStep(
        back = null,
        heading =
            StepHeading(
                icon = BrambleIconName.BOOK,
                title = "Finish your backup",
                lede = "Your recovery phrase has not been confirmed yet. Save it and confirm it to open your wallet.",
            ),
        content = {
            BrambleField(
                label = "Confirm vault passphrase",
                placeholder = "",
                value = passphrase,
                onValueChange = { passphrase = it },
                hint = "Re-enter it to reveal. An unlocked session alone is not enough.",
            )
        },
        cta = {
            PillButton(
                "Show recovery phrase",
                icon = BrambleIconName.BOOK,
                busy = store.busy,
                enabled = passphrase.isNotEmpty(),
            ) {
                val attempt = passphrase
                passphrase = ""
                scope.launch { runCatching { submit(attempt) }.onFailure(store::showError) }
            }
        },
    )
}
