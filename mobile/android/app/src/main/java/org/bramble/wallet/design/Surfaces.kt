package org.bramble.wallet.design

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import org.bramble.core.TokenGlyph

// Structural components from `styles-base.ts`, ported from the iOS Surfaces.swift: grouped menu
// lists with inset hairlines, the flow header with its network pill, and the onboarding badge,
// option card, and detail row.

private val lgShape = RoundedCornerShape(BrambleRadius.lg)
private val mdShape = RoundedCornerShape(BrambleRadius.md)

/** `.menu-list`: one panel per group; separate rows with [MenuDivider]. */
@Composable
fun MenuGroup(content: @Composable ColumnScope.() -> Unit) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxWidth().clip(lgShape).background(skin.panel, lgShape), content = content)
}

/** The hairline between menu rows, inset from the leading edge. */
@Composable
fun MenuDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = BrambleSpace.lg)
            .height(BrambleLayout.hairline)
            .background(LocalSkin.current.hairline),
    )
}

/** `button.menu-row`: icon, label, optional trailing value, chevron or check; 52dp tall. */
@Composable
fun MenuRow(
    icon: BrambleIconName?,
    title: String,
    value: String? = null,
    tone: Color? = null,
    selected: Boolean = false,
    chevron: Boolean = true,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) { this.selected = selected }
            .fillPress(
                if (selected) skin.accentSoft else Color.Transparent,
                skin.softPress,
                mdShape,
                pressedScale = 1f,
                onClick = onClick,
            ).heightIn(min = BrambleLayout.menuRowMin)
            .padding(horizontal = BrambleSpace.lg),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Box(
                Modifier.width(BrambleLayout.menuIconSlot),
            ) { BrambleIcon(icon, tone ?: skin.muted, BrambleLayout.menuIcon) }
        }
        Text(
            title,
            color = tone ?: skin.text,
            style = textStyle(BrambleTypeScale.row, BrambleWeight.medium),
            modifier = Modifier.weight(1f),
        )
        if (value != null) {
            Text(
                value,
                color = skin.muted,
                style = textStyle(BrambleTypeScale.body, BrambleWeight.medium),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (selected) {
            BrambleIcon(BrambleIconName.CHECK, skin.accent)
        } else if (chevron) {
            BrambleIcon(BrambleIconName.CHEVRON_RIGHT, skin.muted)
        }
    }
}

/** `.onboarding-step-icon`: a 54dp elevated disc around a 24dp icon. */
@Composable
fun Medallion(icon: BrambleIconName) {
    val skin = LocalSkin.current
    Box(
        Modifier.size(BrambleLayout.medallion).background(skin.elevated, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        BrambleIcon(icon, skin.text, BrambleLayout.medallionIcon)
    }
}

/** `.onboarding-option`: elevated card with an icon disc, copy, and chevron. */
@Composable
fun OptionCard(
    icon: BrambleIconName,
    title: String,
    detail: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else DISABLED_CONTROL_ALPHA)
            .semantics(mergeDescendants = true) {}
            .fillPress(skin.elevated, skin.softPress, lgShape, enabled = enabled, onClick = onClick)
            .heightIn(min = BrambleLayout.optionCardMin)
            .padding(BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(BrambleSize.mark).background(skin.panel, CircleShape), contentAlignment = Alignment.Center) {
            BrambleIcon(icon, skin.text)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            Text(title, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
            Text(detail, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        }
        BrambleIcon(BrambleIconName.CHEVRON_RIGHT, skin.muted)
    }
}

/** `.onboarding-complete-detail`: an elevated row with an icon and a caption. */
@Composable
fun DetailRow(
    icon: BrambleIconName,
    text: String,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = BrambleLayout.detailRowMin)
            .background(skin.elevated, mdShape)
            .padding(horizontal = BrambleSpace.md),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrambleIcon(icon, skin.text, BrambleLayout.detailIcon)
        Text(text, color = skin.muted, style = textStyle(BrambleTypeScale.caption), modifier = Modifier.weight(1f))
    }
}

/** Token mark: the bundled logo drawable, or the neutral letter badge the extension falls back to. */
@Composable
fun TokenMark(
    address: String,
    symbol: String,
) = TokenBadge(BrambleTokenLogos.drawables[address.lowercase()], symbol.take(1))

/**
 * The core's `tokenGlyph` as a mark (an Activity row's token, `ActivityRow.avatar`): the bundled
 * logo the core picked by its 64-digit key, or the letter badge with the core's letters.
 */
@Composable
fun TokenMark(glyph: TokenGlyph) = TokenBadge(glyph.logoAddress?.let { BrambleTokenLogos.drawables[it] }, glyph.letters)

@Composable
private fun TokenBadge(
    logo: Int?,
    letters: String,
) {
    val skin = LocalSkin.current
    Box(Modifier.size(BrambleSize.mark).clip(CircleShape), contentAlignment = Alignment.Center) {
        if (logo != null) {
            Image(painterResource(logo), contentDescription = null, modifier = Modifier.size(BrambleSize.mark))
        } else {
            Box(Modifier.size(BrambleSize.mark).background(skin.sunken), contentAlignment = Alignment.Center) {
                Text(letters, color = skin.muted, style = textStyle(BrambleTypeScale.body, BrambleWeight.bold))
            }
        }
    }
}

/**
 * `details > summary` (the recovery families, "Wallet identity"): an elevated section whose header
 * row toggles [content]; [detail] sits after the title (a count), and the chevron shows the state.
 */
@Composable
fun Disclosure(
    title: String,
    open: Boolean,
    onToggle: () -> Unit,
    detail: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val skin = LocalSkin.current
    Column(Modifier.fillMaxWidth().clip(lgShape).background(skin.elevated, lgShape)) {
        Row(
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { stateDescription = if (open) "Expanded" else "Collapsed" }
                .fillPress(Color.Transparent, skin.softPress, lgShape, pressedScale = 1f, onClick = onToggle)
                .heightIn(min = BrambleLayout.menuRowMin)
                .padding(horizontal = BrambleSpace.md),
            horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, color = skin.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.semibold))
            Text(
                detail ?: "",
                color = skin.muted,
                style = textStyle(BrambleTypeScale.caption),
                modifier = Modifier.weight(1f),
            )
            BrambleIcon(if (open) BrambleIconName.CHEVRON_DOWN else BrambleIconName.CHEVRON_RIGHT, skin.muted)
        }
        if (open) {
            Column(
                Modifier.fillMaxWidth().padding(
                    start = BrambleSpace.md,
                    end = BrambleSpace.md,
                    bottom = BrambleSpace.md,
                ),
                verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
                content = content,
            )
        }
    }
}
