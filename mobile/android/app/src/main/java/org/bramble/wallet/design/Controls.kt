package org.bramble.wallet.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp

// Buttons and fields from `styles-controls.ts`, ported from the iOS Controls.swift: pill CTAs,
// circular icon buttons, filled fields, check rows, the segmented control.

/** Opacity of a disabled control, as the side panel's `:disabled` rule. */
internal const val DISABLED_CONTROL_ALPHA = 0.5f

/** Opacity of a pill while its action runs (the spinner replaces the label). */
private const val BUSY_PILL_ALPHA = 0.7f

/** The pill button variants of `styles-controls.ts`. */
enum class PillKind {
    /** Accent fill: the screen's main action. */
    PRIMARY,

    /** Elevated fill with body ink. */
    SECONDARY,

    /** Elevated fill with danger ink, for destructive actions. */
    DANGER,

    /** No fill, muted ink. */
    GHOST,
}

/** A pill's resting fill, ink, and pressed fill for one [PillKind]. */
private data class PillColors(
    val fill: Color,
    val ink: Color,
    val pressed: Color,
)

private fun pillColors(
    kind: PillKind,
    skin: BrambleSkin,
): PillColors {
    val fill =
        when (kind) {
            PillKind.PRIMARY -> skin.accent
            PillKind.SECONDARY, PillKind.DANGER -> skin.elevated
            PillKind.GHOST -> Color.Transparent
        }
    val ink =
        when (kind) {
            PillKind.PRIMARY -> skin.accentText
            PillKind.SECONDARY -> skin.text
            PillKind.DANGER -> skin.danger
            PillKind.GHOST -> skin.muted
        }
    val pressed =
        when (kind) {
            PillKind.PRIMARY -> skin.accentPress
            PillKind.DANGER -> skin.dangerSoft
            PillKind.SECONDARY, PillKind.GHOST -> skin.softPress
        }
    return PillColors(fill, ink, pressed)
}

private fun pillAlpha(
    enabled: Boolean,
    busy: Boolean,
): Float =
    if (!enabled) {
        DISABLED_CONTROL_ALPHA
    } else if (busy) {
        BUSY_PILL_ALPHA
    } else {
        1f
    }

/** One of the extension's stroke icons, tinted like `currentColor`. Decorative to accessibility. */
@Composable
fun BrambleIcon(
    name: BrambleIconName,
    tint: Color,
    size: Dp = BrambleControl.icon,
    modifier: Modifier = Modifier,
) {
    Icon(painterResource(name.drawable), contentDescription = null, tint = tint, modifier = modifier.size(size))
}

/** The press feedback every control shares: a scale over `pressMs` on the out ease. */
@Composable
fun pressScale(
    interaction: MutableInteractionSource,
    pressedScale: Float,
): Float {
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (pressed) pressedScale else 1f,
        brambleTween(BrambleMotion.pressMs),
        label = "press",
    )
    return scale
}

/** Clickable with the fill shift and press scale of iOS `FillPressStyle`, no ripple. */
@Composable
fun Modifier.fillPress(
    fill: Color,
    pressed: Color,
    shape: Shape,
    pressedScale: Float = 0.98f,
    enabled: Boolean = true,
    role: Role = Role.Button,
    onClick: () -> Unit,
): Modifier {
    val interaction = remember { MutableInteractionSource() }
    val isPressed by interaction.collectIsPressedAsState()
    val scale = pressScale(interaction, pressedScale)
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
    }.background(if (isPressed) pressed else fill, shape)
        .clickable(
            interactionSource = interaction,
            indication = null,
            enabled = enabled,
            role = role,
            onClick = onClick,
        )
}

/** The full-radius shape of pills, chips, and the segmented control. */
internal val capsule = RoundedCornerShape(percent = 50)

/** `button` in the side panel: a full-radius pill at the control height. */
@Composable
fun PillButton(
    title: String,
    modifier: Modifier = Modifier,
    kind: PillKind = PillKind.PRIMARY,
    icon: BrambleIconName? = null,
    busy: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val (fill, ink, pressed) = pillColors(kind, LocalSkin.current)
    Box(
        modifier
            .fillMaxWidth()
            .alpha(pillAlpha(enabled, busy))
            .fillPress(fill, pressed, capsule, enabled = enabled && !busy, onClick = onClick)
            .heightIn(min = BrambleSize.control)
            .padding(horizontal = BrambleSpace.lg),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.alpha(if (busy) 0f else 1f),
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) BrambleIcon(icon, ink)
            Text(
                title,
                color = ink,
                style = textStyle(BrambleTypeScale.row, BrambleWeight.medium, BrambleTracking.label),
            )
        }
        if (busy) {
            CircularProgressIndicator(
                color = ink,
                strokeWidth = BrambleLayout.checkStroke,
                modifier = Modifier.size(BrambleControl.icon),
            )
        }
    }
}

/** `button.icon-button`: a transparent 40dp circle around one icon, labelled for accessibility. */
@Composable
fun IconButton(
    icon: BrambleIconName,
    label: String,
    tint: Color? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Box(
        Modifier
            .semantics { contentDescription = label }
            .alpha(if (enabled) 1f else DISABLED_CONTROL_ALPHA)
            .fillPress(
                Color.Transparent,
                skin.softPress,
                CircleShape,
                pressedScale = 0.96f,
                enabled = enabled,
                onClick = onClick,
            ).size(BrambleControl.hit),
        contentAlignment = Alignment.Center,
    ) {
        BrambleIcon(icon, tint ?: skin.text)
    }
}

/**
 * `input`: elevated fill and `md` radius, with no edge. An [invalid] field turns to the
 * `dangerSoft` fill with `danger` text. The input inside is always the one hardened [SecretField]
 * (passphrases, phrase words, and the Send recipient and amount, by [kind]).
 */
@Composable
fun BrambleField(
    label: String?,
    placeholder: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    kind: SecretKind = SecretKind.PASSPHRASE,
    invalid: Boolean = false,
    hint: String? = null,
    onSubmit: (() -> Unit)? = null,
) {
    val skin = LocalSkin.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(BrambleLayout.fieldLabelGap)) {
        if (label != null) {
            Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
        }
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = BrambleSize.control)
                .background(if (invalid) skin.dangerSoft else skin.elevated, RoundedCornerShape(BrambleRadius.md))
                .padding(horizontal = BrambleSpace.md),
            contentAlignment = Alignment.CenterStart,
        ) {
            SecretField(
                value = value,
                onValueChange = onValueChange,
                accessibilityLabel = label ?: placeholder,
                kind = kind,
                placeholder = placeholder,
                textColor = if (invalid) skin.danger else skin.text,
                onImeAction = onSubmit,
            )
        }
        if (hint != null) Text(hint, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
    }
}
