package org.bramble.wallet.ui.wallet

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import org.bramble.wallet.Tab
import org.bramble.wallet.design.BrambleControl
import org.bramble.wallet.design.BrambleEase
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleMotion
import org.bramble.wallet.design.BrambleShadow
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.brambleShadow
import org.bramble.wallet.design.brambleTween
import org.bramble.wallet.design.fillPress

/** `.wallet-dock`: a floating pill of three 44dp items; the active one sits on accent-soft. */
@Composable
fun FloatingDock(
    tab: Tab,
    onSelect: (Tab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val skin = LocalSkin.current
    val pill = RoundedCornerShape(percent = 50)
    Row(
        modifier
            .brambleShadow(BrambleShadow.md, pill)
            .background(skin.panel, pill)
            .padding(vertical = BrambleLayout.dockPaddingVertical, horizontal = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        DockItem(Tab.HOME, BrambleIconName.HOME, "Home", tab, onSelect)
        DockItem(Tab.ACTIVITY, BrambleIconName.ACTIVITY, "Activity", tab, onSelect)
        DockItem(Tab.SETTINGS, BrambleIconName.SETTINGS, "Settings", tab, onSelect)
    }
}

@Composable
private fun DockItem(
    target: Tab,
    icon: BrambleIconName,
    label: String,
    tab: Tab,
    onSelect: (Tab) -> Unit,
) {
    val skin = LocalSkin.current
    val selected = tab == target
    val fill by animateColorAsState(
        if (selected) skin.accentSoft else Color.Transparent,
        brambleTween(BrambleMotion.tabMs, BrambleEase.standard),
        label = "dock",
    )
    val ink by animateColorAsState(
        if (selected) skin.accent else skin.muted,
        brambleTween(BrambleMotion.tabMs, BrambleEase.standard),
        label = "dock-ink",
    )
    Box(
        Modifier
            .semantics {
                contentDescription = label
                this.selected = selected
            }.fillPress(fill, skin.softPress, CircleShape, pressedScale = 0.96f, role = Role.Tab) { onSelect(target) }
            .size(BrambleControl.dockItem),
        contentAlignment = Alignment.Center,
    ) {
        BrambleIcon(icon, ink, BrambleControl.dockIcon)
    }
}
