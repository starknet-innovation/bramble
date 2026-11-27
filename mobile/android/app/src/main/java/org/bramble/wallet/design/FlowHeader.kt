package org.bramble.wallet.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

// The flow header and its network pill from `styles-base.ts`, ported from the iOS Surfaces.swift.

/** `.pill` with the network dot: positive when the network answered, warning while unknown. */
@Composable
fun NetworkPill(
    label: String,
    healthy: Boolean = true,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .height(BrambleSize.pill + BrambleLayout.pillExtraHeight)
            .background(skin.elevated, RoundedCornerShape(percent = 50))
            .padding(horizontal = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleLayout.pillGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(healthy)
        Text(label, color = skin.text, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
    }
}

/** The 6dp network-health dot. */
@Composable
fun StatusDot(healthy: Boolean) {
    val skin = LocalSkin.current
    Box(Modifier.size(BrambleLayout.statusDot).background(if (healthy) skin.positive else skin.warning, CircleShape))
}

/** `.flow-header`: back control, title and subtitle, network pill. */
@Composable
fun FlowHeader(
    title: String,
    subtitle: String? = null,
    network: String? = null,
    back: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier.fillMaxWidth().padding(top = BrambleLayout.flowHeaderTop, bottom = BrambleSpace.xs),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(BrambleIconName.CHEVRON_LEFT, "Back", tint = skin.muted, onClick = back)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.subtitleGap)) {
            Text(
                title,
                color = skin.text,
                style = textStyle(BrambleTypeScale.headline, BrambleWeight.bold, BrambleTracking.display),
            )
            if (subtitle != null) Text(subtitle, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        }
        if (network != null) NetworkPill(network)
    }
}
