package org.bramble.wallet.design

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics

// Selection controls from `styles-controls.ts`, ported from the iOS Controls.swift: check rows,
// filter chips, the segmented control.

/** The check row's box: accent-filled with a check mark when [checked], outlined otherwise. */
@Composable
private fun CheckBoxMark(checked: Boolean) {
    val skin = LocalSkin.current
    val box = RoundedCornerShape(BrambleLayout.checkRadius)
    Box(
        Modifier
            .padding(top = BrambleLayout.checkNudge)
            .size(BrambleLayout.checkBox)
            .background(if (checked) skin.accent else Color.Transparent, box)
            .border(BrambleLayout.checkStroke, if (checked) skin.accent else skin.border, box),
        contentAlignment = Alignment.Center,
    ) {
        if (checked) BrambleIcon(BrambleIconName.CHECK, skin.accentText, BrambleLayout.checkIcon)
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
    val titleWeight = if (detail != null) BrambleWeight.semibold else BrambleWeight.regular
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else DISABLED_CONTROL_ALPHA)
            .toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onCheckedChange),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        CheckBoxMark(checked)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(
                text,
                color = skin.text,
                style = textStyle(BrambleTypeScale.body, titleWeight),
            )
            detail?.invoke(this)
        }
    }
}

/** The check row's box: accent-filled with a check mark when [checked], outlined otherwise. */
@Composable
private fun CheckBoxMark(checked: Boolean) {
    val skin = LocalSkin.current
    val box = RoundedCornerShape(BrambleLayout.checkRadius)
    Box(
        Modifier
            .padding(top = BrambleLayout.checkNudge)
            .size(BrambleLayout.checkBox)
            .background(if (checked) skin.accent else Color.Transparent, box)
            .border(BrambleLayout.checkStroke, if (checked) skin.accent else skin.border, box),
        contentAlignment = Alignment.Center,
    ) {
        if (checked) BrambleIcon(BrambleIconName.CHECK, skin.accentText, BrambleLayout.checkIcon)
    }
}

/**
 * `.account-filter-chip` / the group icon picker: a capsule toggle on the elevated fill, accent-soft
 * when [selected] (the extension's `aria-pressed`). An icon-only chip is named by [description].
 */
@Composable
fun FilterChip(
    label: String?,
    icon: BrambleIconName?,
    selected: Boolean,
    description: String? = null,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .semantics(mergeDescendants = true) {
                this.selected = selected
                if (description != null) contentDescription = description
            }.fillPress(if (selected) skin.accentSoft else skin.elevated, skin.softPress, capsule, onClick = onClick)
            .heightIn(min = BrambleControl.hitSmall)
            .padding(horizontal = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilterChipContent(label, icon, selected)
    }
}

/** A filter chip's optional icon and label, accent and body ink when [selected]. */
@Composable
private fun FilterChipContent(
    label: String?,
    icon: BrambleIconName?,
    selected: Boolean,
) {
    val skin = LocalSkin.current
    if (icon != null) BrambleIcon(icon, if (selected) skin.accent else skin.muted, BrambleLayout.detailIcon)
    if (label != null) {
        Text(
            label,
            color = if (selected) skin.text else skin.muted,
            style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold),
        )
    }
}

/** `segmentedControl`: a sunken track whose selected segment rises on the panel fill. */
@Composable
fun <T> SegmentedControl(
    options: List<Pair<String, T>>,
    selection: T,
    enabled: Boolean = true,
    onSelect: (T) -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(
                if (enabled) 1f else DISABLED_CONTROL_ALPHA,
            ).background(skin.sunken, capsule)
            .padding(BrambleLayout.segmentInset),
    ) {
        options.forEach { (label, value) ->
            Segment(label, value == selection, enabled) { onSelect(value) }
        }
    }
}

/** One equal-width segment; the selected one rises on the panel fill with a small shadow. */
@Composable
private fun RowScope.Segment(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    val fill by animateColorAsState(
        if (selected) skin.panel else Color.Transparent,
        brambleTween(BrambleMotion.tabMs, BrambleEase.inOut),
        label = "segment",
    )
    Box(
        Modifier
            .weight(1f)
            .then(if (selected) Modifier.brambleShadow(BrambleShadow.xs, capsule) else Modifier)
            .background(fill, capsule)
            .selectable(selected = selected, enabled = enabled, role = Role.Tab, onClick = onClick)
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
