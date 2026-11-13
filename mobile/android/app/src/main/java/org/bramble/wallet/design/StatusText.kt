package org.bramble.wallet.design

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

// Text lines from `styles-base.ts`, ported from the iOS Controls.swift: the eyebrow caption and
// the status line, plus the flexible spacer that pushes actions to a column's foot.

/** `.eyebrow`: uppercase caption in the muted ink. */
@Composable
fun Eyebrow(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text.uppercase(),
        color = LocalSkin.current.muted,
        style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold, BrambleTracking.eyebrow),
        modifier = modifier,
    )
}

/** The ink of a [StatusLine]. */
enum class StatusTone {
    /** Neutral progress or hint text. */
    MUTED,

    /** A failure. */
    DANGER,

    /** A success. */
    POSITIVE,
}

/** `[role=status]` / `.hint` line: caption in muted, danger or positive for outcomes. */
@Composable
fun StatusLine(
    text: String?,
    tone: StatusTone = StatusTone.MUTED,
) {
    if (text == null) return
    val skin = LocalSkin.current
    val color =
        when (tone) {
            StatusTone.MUTED -> skin.muted
            StatusTone.DANGER -> skin.danger
            StatusTone.POSITIVE -> skin.positive
        }
    Text(text, color = color, style = textStyle(BrambleTypeScale.caption), modifier = Modifier.fillMaxWidth())
}

/** Fills the remaining height of a column, as SwiftUI `Spacer()`. */
@Composable
fun ColumnScope.FlexSpacer() = Spacer(Modifier.weight(1f))
