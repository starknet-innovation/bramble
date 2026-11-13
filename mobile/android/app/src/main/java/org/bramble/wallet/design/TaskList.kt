package org.bramble.wallet.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/**
 * `.privacy-task-list`: a panel with the xs elevation listing a journey's steps, the hairlines
 * inset past the dot. Tasks before [active] are done (positive dot), [active] is under way (accent
 * dot, semibold), and the rest are still to come (muted).
 */
@Composable
fun TaskList(
    labels: List<String>,
    active: Int,
) {
    val skin = LocalSkin.current
    val shape = RoundedCornerShape(BrambleRadius.lg)
    Column(
        Modifier
            .fillMaxWidth()
            .brambleShadow(BrambleShadow.xs, shape)
            .background(skin.panel, shape)
            .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.sm),
    ) {
        labels.forEachIndexed { index, label ->
            if (index > 0) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = BrambleLayout.taskHairlineInset)
                        .height(BrambleLayout.hairline)
                        .background(skin.hairline),
                )
            }
            TaskRow(label, index, active)
        }
    }
}

/** One task: done, under way, or still to come, by its [index] against [active]. */
@Composable
private fun TaskRow(
    label: String,
    index: Int,
    active: Int,
) {
    val skin = LocalSkin.current
    val dot =
        when {
            index < active -> skin.positive
            index == active -> skin.accent
            else -> skin.hairlineStrong
        }
    Row(
        Modifier.fillMaxWidth().heightIn(min = BrambleControl.hit),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(BrambleSpace.sm).background(dot, CircleShape))
        Text(
            label,
            color = if (index > active) skin.muted else skin.text,
            style =
                textStyle(
                    BrambleTypeScale.label,
                    if (index == active) BrambleWeight.semibold else BrambleWeight.regular,
                ),
        )
    }
}
