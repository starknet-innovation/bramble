package org.bramble.wallet.ui.onboarding

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.bramble.core.PassphraseLevel
import org.bramble.core.PassphraseStrength
import org.bramble.core.passphraseStrength
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleMotion
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.CheckRow
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.brambleTween
import org.bramble.wallet.design.textStyle

/**
 * "Create your vault passphrase", port of the iOS `PassphraseStep`. Strength, acceptability and
 * the weak acknowledgement all come from the core's `passphrase_strength`; nothing is scored here.
 * [submit] writes the vault; the typed values are cleared once it succeeds.
 */
@Composable
fun PassphraseStep(store: WalletStore, path: OnboardingPath, back: () -> Unit, submit: suspend (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var passphrase by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var weakTicked by remember { mutableStateOf(false) }
    val strength = remember(passphrase) { passphraseStrength(passphrase) }
    LaunchedEffect(strength.needsAcknowledgement) { weakTicked = WeakAck.sync(strength.needsAcknowledgement, weakTicked) }
    val matches = strength.acceptable && confirmation.isNotEmpty() && passphrase == confirmation
    OnboardingStep(
        back = back,
        icon = BrambleIconName.LOCK,
        title = "Create your vault passphrase",
        lede = "You will use this to unlock Bramble on this device.",
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
                BrambleField(
                    label = "Vault passphrase",
                    placeholder = "At least 8 characters",
                    value = passphrase,
                    onValueChange = { passphrase = it },
                    hint = "Use at least 8 characters; 12 or more is safer. This unlocks the encrypted vault on this device.",
                )
                BrambleField(label = "Confirm passphrase", placeholder = "Enter it again", value = confirmation, onValueChange = { confirmation = it })
                PassphraseMeter(strength, meterStatus(strength, confirmation, matches), ready = matches)
                if (strength.needsAcknowledgement) {
                    CheckRow(
                        "This passphrase is weak. I understand it is all that protects this wallet on this device.",
                        checked = weakTicked,
                        onCheckedChange = { weakTicked = it },
                    )
                }
            }
        },
        cta = {
            PillButton(
                if (path == OnboardingPath.CREATE) "Continue" else "Find your accounts",
                busy = store.busy,
                enabled = matches && WeakAck.ok(strength.needsAcknowledgement, weakTicked),
            ) {
                scope.launch {
                    runCatching { submit(passphrase) }
                        .onSuccess {
                            passphrase = ""
                            confirmation = ""
                        }
                        .onFailure(store::showError)
                }
            }
        },
    )
}

/** `applyPassphraseMeter`'s status line. */
private fun meterStatus(strength: PassphraseStrength, confirmation: String, matches: Boolean): String = when {
    !strength.acceptable || confirmation.isEmpty() -> strength.hint
    matches -> "${strength.hint} · Passphrases match"
    else -> "Passphrases do not match"
}

/** `.password-requirement`: a 4dp track filled by the meter ratio in the band's colour. */
@Composable
private fun PassphraseMeter(strength: PassphraseStrength, status: String, ready: Boolean) {
    val skin = LocalSkin.current
    val fill = when (strength.level) {
        PassphraseLevel.WEAK -> skin.danger
        PassphraseLevel.FAIR -> skin.warning
        PassphraseLevel.STRONG -> skin.positive
        PassphraseLevel.EMPTY -> skin.muted
    }
    val ratio by animateFloatAsState(strength.ratio.toFloat().coerceIn(0f, 1f), brambleTween(BrambleMotion.enterMs), label = "meter")
    val track = RoundedCornerShape(percent = 50)
    Column(verticalArrangement = Arrangement.spacedBy(BrambleLayout.meterGap)) {
        Box(Modifier.fillMaxWidth().height(BrambleLayout.meterTrack).background(skin.elevated, track)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(ratio).background(fill, track))
        }
        Text(status, color = if (ready) skin.positive else skin.muted, style = textStyle(BrambleTypeScale.caption))
    }
}
