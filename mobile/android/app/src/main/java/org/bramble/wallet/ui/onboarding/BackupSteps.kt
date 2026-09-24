package org.bramble.wallet.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.textStyle

/**
 * `data-onboarding-step="generated"`, port of the iOS `SavePhraseStep`: the words stay masked
 * until deliberately revealed, and the CTA is enabled only while they are shown. `FLAG_SECURE`
 * keeps them out of screenshots and recordings, so there is no separate capture state as on iOS.
 */
@Composable
fun SavePhraseStep(words: List<String>, next: () -> Unit) {
    val skin = LocalSkin.current
    var revealed by remember { mutableStateOf(false) }
    OnboardingStep(
        back = null,
        icon = BrambleIconName.BOOK,
        title = "Save your recovery phrase",
        lede = "Write these words down in order and keep them offline.",
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
                RecoveryWordGrid(words, masked = !revealed)
                PillButton(
                    if (revealed) "Hide recovery phrase" else "Show recovery phrase",
                    kind = PillKind.SECONDARY,
                    icon = BrambleIconName.BOOK,
                ) { revealed = !revealed }
                Text(
                    "Anyone with these words controls the wallet. Bramble cannot recover them for you.",
                    color = skin.muted,
                    style = textStyle(BrambleTypeScale.caption),
                )
                StatusLine("Reveal the phrase, save it offline, then continue.")
            }
        },
        cta = { PillButton("I saved my phrase", enabled = revealed, onClick = next) },
    )
}

/** Port of the iOS `ConfirmBackupStep`: three requested words, checked by [BackupVerify]. */
@Composable
fun ConfirmBackupStep(words: List<String>, back: () -> Unit, next: () -> Unit) {
    var answers by remember { mutableStateOf(List(BackupVerify.POSITIONS.size) { "" }) }
    DisposableEffect(Unit) { onDispose { answers = emptyList() } }
    val confirmed = BackupVerify.confirmed(words, answers)
    OnboardingStep(
        back = back,
        icon = BrambleIconName.SHIELD,
        title = "Confirm your backup",
        lede = "Enter the requested words to make sure your offline copy is accurate.",
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
                Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                    BackupVerify.POSITIONS.forEachIndexed { index, position ->
                        BrambleField(
                            label = "Word $position",
                            placeholder = "",
                            value = answers.getOrElse(index) { "" },
                            onValueChange = { value -> answers = answers.toMutableList().also { it[index] = value } },
                            modifier = Modifier.weight(1f),
                            kind = SecretKind.WORD,
                        )
                    }
                }
                StatusLine(if (confirmed) "Backup confirmed." else "Enter the requested words to continue.")
            }
        },
        cta = { PillButton("Continue", enabled = confirmed, onClick = next) },
    )
}
