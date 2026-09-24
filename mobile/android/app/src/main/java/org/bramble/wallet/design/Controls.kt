package org.bramble.wallet.design

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
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
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp

// Buttons and fields from `styles-controls.ts`, ported from the iOS Controls.swift: pill CTAs,
// circular icon buttons, filled fields, check rows, the segmented control.

enum class PillKind { PRIMARY, SECONDARY, DANGER, GHOST }

/** One of the extension's stroke icons, tinted like `currentColor`. Decorative to accessibility. */
@Composable
fun BrambleIcon(name: BrambleIconName, tint: Color, size: Dp = BrambleControl.icon, modifier: Modifier = Modifier) {
    Icon(painterResource(name.drawable), contentDescription = null, tint = tint, modifier = modifier.size(size))
}

/** The press feedback every control shares: a scale over `pressMs` on the out ease. */
@Composable
fun pressScale(interaction: MutableInteractionSource, pressedScale: Float): Float {
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) pressedScale else 1f, brambleTween(BrambleMotion.pressMs), label = "press")
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
    return graphicsLayer { scaleX = scale; scaleY = scale }
        .background(if (isPressed) pressed else fill, shape)
        .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = role, onClick = onClick)
}

private val capsule = RoundedCornerShape(percent = 50)

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
    val skin = LocalSkin.current
    val fill = when (kind) {
        PillKind.PRIMARY -> skin.accent
        PillKind.SECONDARY, PillKind.DANGER -> skin.elevated
        PillKind.GHOST -> Color.Transparent
    }
    val ink = when (kind) {
        PillKind.PRIMARY -> skin.accentText
        PillKind.SECONDARY -> skin.text
        PillKind.DANGER -> skin.danger
        PillKind.GHOST -> skin.muted
    }
    val pressed = when (kind) {
        PillKind.PRIMARY -> skin.accentPress
        PillKind.DANGER -> skin.dangerSoft
        PillKind.SECONDARY, PillKind.GHOST -> skin.softPress
    }
    Box(
        modifier.fillMaxWidth()
            .alpha(if (!enabled) 0.5f else if (busy) 0.7f else 1f)
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
            Text(title, color = ink, style = textStyle(BrambleTypeScale.row, BrambleWeight.medium, BrambleTracking.label))
        }
        if (busy) CircularProgressIndicator(color = ink, strokeWidth = BrambleLayout.checkStroke, modifier = Modifier.size(BrambleControl.icon))
    }
}

/** `button.icon-button`: a transparent 40dp circle around one icon, labelled for accessibility. */
@Composable
fun IconButton(icon: BrambleIconName, label: String, tint: Color? = null, enabled: Boolean = true, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Box(
        Modifier.semantics { contentDescription = label }
            .alpha(if (enabled) 1f else 0.5f)
            .fillPress(Color.Transparent, skin.softPress, CircleShape, pressedScale = 0.96f, enabled = enabled, onClick = onClick)
            .size(BrambleControl.hit),
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
        if (label != null) Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
        Box(
            Modifier.fillMaxWidth()
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

/**
 * `label:has(> input[type=checkbox])`: an accent checkbox row; the whole row toggles. With
 * [detail] (a recovery candidate's address and hint) the text is the row's semibold title.
 */
@Composable
fun CheckRow(
    text: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
    detail: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val skin = LocalSkin.current
    val box = RoundedCornerShape(BrambleLayout.checkRadius)
    Row(
        Modifier.fillMaxWidth()
            .alpha(if (enabled) 1f else 0.5f)
            .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onCheckedChange),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Box(
            Modifier.padding(top = BrambleLayout.checkNudge)
                .size(BrambleLayout.checkBox)
                .background(if (checked) skin.accent else Color.Transparent, box)
                .border(BrambleLayout.checkStroke, if (checked) skin.accent else skin.border, box),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) BrambleIcon(BrambleIconName.CHECK, skin.accentText, BrambleLayout.checkIcon)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(
                text,
                color = skin.text,
                style = textStyle(BrambleTypeScale.body, if (detail != null) BrambleWeight.semibold else BrambleWeight.regular),
            )
            detail?.invoke(this)
        }
    }
}

/**
 * `.account-filter-chip` / the group icon picker: a capsule toggle on the elevated fill, accent-soft
 * when [selected] (the extension's `aria-pressed`). An icon-only chip is named by [description].
 */
@Composable
fun FilterChip(label: String?, icon: BrambleIconName?, selected: Boolean, description: String? = null, onClick: () -> Unit) {
    val skin = LocalSkin.current
    Row(
        Modifier.semantics(mergeDescendants = true) {
            this.selected = selected
            if (description != null) contentDescription = description
        }
            .fillPress(if (selected) skin.accentSoft else skin.elevated, skin.softPress, capsule, onClick = onClick)
            .heightIn(min = BrambleControl.hitSmall)
            .padding(horizontal = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) BrambleIcon(icon, if (selected) skin.accent else skin.muted, BrambleLayout.detailIcon)
        if (label != null) {
            Text(label, color = if (selected) skin.text else skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
        }
    }
}

/** `segmentedControl`: a sunken track whose selected segment rises on the panel fill. */
@Composable
fun <T> SegmentedControl(options: List<Pair<String, T>>, selection: T, enabled: Boolean = true, onSelect: (T) -> Unit) {
    val skin = LocalSkin.current
    Row(
        Modifier.fillMaxWidth().alpha(if (enabled) 1f else 0.5f).background(skin.sunken, capsule).padding(BrambleLayout.segmentInset),
    ) {
        options.forEach { (label, value) ->
            val selected = value == selection
            val fill by animateColorAsState(
                if (selected) skin.panel else Color.Transparent,
                brambleTween(BrambleMotion.tabMs, BrambleEase.inOut),
                label = "segment",
            )
            Box(
                Modifier.weight(1f)
                    .then(if (selected) Modifier.brambleShadow(BrambleShadow.xs, capsule) else Modifier)
                    .background(fill, capsule)
                    .selectable(selected = selected, enabled = enabled, role = Role.Tab, onClick = { onSelect(value) })
                    .heightIn(min = BrambleLayout.segmentHeight),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    color = if (selected) skin.text else skin.muted,
                    style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
                )
            }
        }
    }
}

/** `.eyebrow`: uppercase caption in the muted ink. */
@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        color = LocalSkin.current.muted,
        style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold, BrambleTracking.eyebrow),
        modifier = modifier,
    )
}

enum class StatusTone { MUTED, DANGER, POSITIVE }

/** `[role=status]` / `.hint` line: caption in muted, danger or positive for outcomes. */
@Composable
fun StatusLine(text: String?, tone: StatusTone = StatusTone.MUTED) {
    if (text == null) return
    val skin = LocalSkin.current
    val color = when (tone) {
        StatusTone.MUTED -> skin.muted
        StatusTone.DANGER -> skin.danger
        StatusTone.POSITIVE -> skin.positive
    }
    Text(text, color = color, style = textStyle(BrambleTypeScale.caption), modifier = Modifier.fillMaxWidth())
}

/** Fills the remaining height of a column, as SwiftUI `Spacer()`. */
@Composable
fun androidx.compose.foundation.layout.ColumnScope.FlexSpacer() = Spacer(Modifier.weight(1f))
