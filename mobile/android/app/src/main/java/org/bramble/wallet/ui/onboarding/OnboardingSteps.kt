package org.bramble.wallet.ui.onboarding

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import org.bramble.core.isRecoveryWord
import org.bramble.core.isValidRecoveryPhrase
import org.bramble.wallet.R
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.DetailRow
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlexSpacer
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.OptionCard
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.ui.HEADLINE_TRACKING

// Each step reproduces its extension counterpart in `onboarding-views.ts` /
// `onboarding-surface.ts`, through the iOS OnboardingSteps: same badge, heading, lede, CTA copy.

/** `.onboarding-welcome`: wordmark lockup, two actions, the local-encryption note. */
@Composable
fun WelcomeStep(create: () -> Unit, recover: () -> Unit) {
    val skin = LocalSkin.current
    Column(
        Modifier.fillMaxSize().padding(
            start = BrambleLayout.onboardingGutter,
            end = BrambleLayout.onboardingGutter,
            top = BrambleLayout.welcomeTop,
            bottom = BrambleLayout.onboardingFoot,
        ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlexSpacer()
        Image(
            painterResource(R.drawable.brand_wordmark),
            contentDescription = "Bramble",
            colorFilter = ColorFilter.tint(skin.text),
            modifier = Modifier.width(BrambleLayout.wordmarkWidth),
        )
        FlexSpacer()
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            PillButton("Create a new wallet", onClick = create)
            PillButton("Add an existing wallet", kind = PillKind.SECONDARY, onClick = recover)
        }
        Row(
            Modifier.padding(top = BrambleSpace.sm),
            horizontalArrangement = Arrangement.spacedBy(BrambleLayout.pillGap),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrambleIcon(BrambleIconName.LOCK, skin.muted, BrambleLayout.lockNoteIcon)
            Text("Encrypted locally on this device", color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        }
    }
}

/** "Choose how to add your wallet": only the recovery phrase is available on mobile so far. */
@Composable
fun ImportMethodStep(back: () -> Unit, recoveryPhrase: () -> Unit) {
    OnboardingStep(
        back = back,
        icon = BrambleIconName.WALLET,
        title = "Choose how to add your wallet",
        lede = "Bring an existing Starknet wallet into Bramble.",
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
                OptionCard(BrambleIconName.BOOK, "Recovery phrase", "Import 12 or 24 recovery words from another wallet.", onClick = recoveryPhrase)
                OptionCard(BrambleIconName.SHIELD, "Ledger hardware wallet", "Coming to Bramble mobile.", enabled = false) {}
                OptionCard(BrambleIconName.LINK, "Private key", "Coming to Bramble mobile.", enabled = false) {}
            }
        },
        cta = {},
    )
}

/**
 * "Enter your recovery phrase". Continue is enabled only when every cell is a BIP-39 word and the
 * core accepts the phrase; the grid is cleared as the phrase is handed on, and when it leaves.
 */
@Composable
fun RecoveryPhraseStep(back: () -> Unit, next: (String) -> Unit) {
    var words by remember { mutableStateOf(RecoveryEntry.empty()) }
    DisposableEffect(Unit) { onDispose { words = emptyList() } }
    val complete = words.isNotEmpty() && words.all { isRecoveryWord(it) } && isValidRecoveryPhrase(words.joinToString(" "))
    OnboardingStep(
        back = back,
        icon = BrambleIconName.BOOK,
        title = "Enter your recovery phrase",
        lede = "Type each word, or paste the complete phrase into the first field. Unknown words are flagged as you go.",
        content = {
            RecoveryEntryGrid(words) { words = it }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                InlineAction(if (words.size == 12) "Use a 24-word phrase" else "Use a 12-word phrase") {
                    words = RecoveryEntry.toggled(words)
                }
            }
        },
        cta = {
            PillButton("Continue", enabled = complete) {
                val phrase = words.joinToString(" ")
                words = List(words.size) { "" }
                next(phrase)
            }
        },
    )
}

/** `onboardingComplete()`: check mark, eyebrow, heading, the two custody details, one action. */
@Composable
fun CompleteStep(open: () -> Unit) {
    val skin = LocalSkin.current
    Column(
        Modifier.fillMaxSize().padding(horizontal = BrambleLayout.completeGutter),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlexSpacer()
        Box(Modifier.size(BrambleSize.brand).background(skin.positive, CircleShape), contentAlignment = Alignment.Center) {
            BrambleIcon(BrambleIconName.CHECK, skin.accentText, BrambleLayout.completeIcon)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            Eyebrow("Setup complete")
            Text("You’re all set", color = skin.text, style = textStyle(BrambleTypeScale.headline, BrambleWeight.heavy, HEADLINE_TRACKING))
            Text(
                "Your account is ready in Bramble. Receive assets, or deploy when you’re ready.",
                color = skin.muted,
                textAlign = TextAlign.Center,
                style = textStyle(BrambleTypeScale.body),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
            DetailRow(BrambleIconName.LOCK, "Vault encrypted locally on this device")
            DetailRow(BrambleIconName.SHIELD, "Recovery and signing material stay behind the wallet boundary")
        }
        PillButton("Open Bramble", onClick = open)
        FlexSpacer()
    }
}
