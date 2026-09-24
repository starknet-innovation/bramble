package org.bramble.wallet.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics

/** How long a toast stays up, as the iOS `RootView` (3 s). */
const val TOAST_LIFETIME_MS = 3_000L

/**
 * `.toast`: a raised panel with a tinted icon tile. Drawn inside the activity window (never a
 * `Popup`), so it inherits `FLAG_SECURE` without extra work; announced as a polite live region.
 */
@Composable
fun Toast(message: String, positive: Boolean = false, modifier: Modifier = Modifier) {
    val skin = LocalSkin.current
    val shape = RoundedCornerShape(BrambleRadius.lg)
    Row(
        modifier.fillMaxWidth()
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }
            .brambleShadow(BrambleShadow.lg, shape)
            .background(skin.panel, shape)
            .padding(BrambleLayout.toastPadding),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(BrambleLayout.toastChip)
                .background(if (positive) skin.positiveSoft else skin.dangerSoft, RoundedCornerShape(BrambleRadius.sm)),
            contentAlignment = Alignment.Center,
        ) {
            BrambleIcon(if (positive) BrambleIconName.CHECK else BrambleIconName.ALERT, if (positive) skin.positive else skin.danger)
        }
        Text(message, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold), modifier = Modifier.weight(1f))
    }
}
