package org.bramble.wallet.ui.onboarding

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import org.bramble.wallet.R
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleShadow
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.LocalThemeChoice
import org.bramble.wallet.design.Medallion
import org.bramble.wallet.design.ThemeChoice
import org.bramble.wallet.design.brambleShadow
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.HEADLINE_TRACKING

// The onboarding surface from `styles-onboarding.ts`, ported from the iOS OnboardingScaffold:
// the brand landscape behind a solid panel card, each step laid out as back control, badge,
// heading, fields, and a CTA pinned to the foot.

/**
 * Share of `--bramble-text` in the midnight landscape multiply:
 * `color-mix(in srgb, var(--bramble-bg) 55%, var(--bramble-text))` in
 * `packages/presentation/wallet-ui/src/sidepanel/styles/onboarding/styles-onboarding.ts`.
 * Text at 45% composited over opaque bg is exactly that sRGB mix (iOS composes it the same way).
 */
private const val LANDSCAPE_TEXT_MIX = 0.45f

/**
 * `body.onboarding-surface`: the extension's landscape (copied from
 * `apps/extension/public/brand` into generated resources at build time, never committed),
 * multiplied down in the midnight skin. Decorative.
 */
@Composable
fun OnboardingBackdrop() {
    val skin = LocalSkin.current
    val dark = LocalThemeChoice.current == ThemeChoice.DARK
    Box(Modifier.fillMaxSize().background(skin.panel)) {
        Image(
            painterResource(R.drawable.onboarding_landscape),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        if (dark) {
            val mix = skin.text.copy(alpha = LANDSCAPE_TEXT_MIX).compositeOver(skin.bg)
            Canvas(Modifier.fillMaxSize()) { drawRect(mix, blendMode = BlendMode.Multiply) }
        }
    }
}

/** `.onboarding-wizard`: the solid card the steps live in, clear of system bars and the keyboard. */
@Composable
fun BoxScope.OnboardingCard(content: @Composable BoxScope.() -> Unit) {
    val skin = LocalSkin.current
    val shape = RoundedCornerShape(BrambleRadius.xl)
    Box(
        Modifier.align(Alignment.Center)
            .safeDrawingPadding()
            .imePadding()
            .padding(horizontal = BrambleSpace.md, vertical = BrambleSpace.sm)
            .widthIn(max = BrambleLayout.cardMaxWidth)
            .fillMaxSize()
            .brambleShadow(BrambleShadow.md, shape)
            .background(skin.panel, shape)
            .clip(shape),
        content = content,
    )
}

/** `.onboarding-step`: back control, `.onboarding-step-head`, body, and `.onboarding-step-cta`. */
@Composable
fun OnboardingStep(
    back: (() -> Unit)?,
    icon: BrambleIconName,
    title: String,
    lede: String,
    content: @Composable ColumnScope.() -> Unit,
    cta: @Composable ColumnScope.() -> Unit,
) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                    .padding(start = BrambleLayout.onboardingGutter, end = BrambleLayout.onboardingGutter, top = BrambleLayout.onboardingTop),
                verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
            ) {
                Column(
                    Modifier.fillMaxWidth().padding(
                        top = if (back == null) BrambleSpace.lg else BrambleLayout.onboardingHeadTopWithBack,
                        bottom = BrambleSpace.md,
                    ),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
                ) {
                    Box(Modifier.padding(bottom = BrambleSpace.sm)) { Medallion(icon) }
                    Text(title, color = skin.text, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.headline, BrambleWeight.heavy, HEADLINE_TRACKING))
                    Text(lede, color = skin.muted, textAlign = TextAlign.Center, style = textStyle(BrambleTypeScale.body))
                }
                content()
            }
            if (back != null) {
                Box(Modifier.padding(start = BrambleSpace.lg, top = BrambleSpace.lg)) {
                    IconButton(BrambleIconName.CHEVRON_LEFT, "Back", tint = skin.muted, onClick = back)
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().padding(
                start = BrambleLayout.onboardingGutter,
                end = BrambleLayout.onboardingGutter,
                top = BrambleSpace.lg,
                bottom = BrambleLayout.onboardingFoot,
            ),
            verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            content = cta,
        )
    }
}

/** `.onboarding-inline-action`: a muted caption-sized text button. */
@Composable
fun InlineAction(title: String, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = BrambleLayout.inlineActionHeight)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = BrambleSpace.md),
        contentAlignment = Alignment.Center,
    ) {
        Text(title, color = LocalSkin.current.muted, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
    }
}
