package org.bramble.wallet.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em

// Hand-written companions to BrambleTokens.generated.kt; see the iOS BrambleTheme.swift twin.

data class BrambleTypeStyle(val size: TextUnit, val lineHeight: Float)
data class BrambleSpringSpec(val response: Float, val damping: Float)
data class BrambleShadowStyle(val y: Dp, val blur: Dp, val alpha: Float)

val BrambleSkin.avatars: List<Color> get() = listOf(accountAvatar0, accountAvatar1, accountAvatar2, accountAvatar3)

/** Dark (midnight) is the default, including anywhere outside `BrambleTheme`. */
val LocalSkin = staticCompositionLocalOf { BrambleSkins.midnight }

/**
 * The extension's `ThemeChoice`: midnight by default, daylight when chosen. No follow-the-system
 * option, matching the extension (system neutrals broke its designed surface tiers).
 */
@Composable
fun BrambleTheme(light: Boolean = false, content: @Composable () -> Unit) {
    val skin = if (light) BrambleSkins.daylight else BrambleSkins.midnight
    CompositionLocalProvider(LocalSkin provides skin, content = content)
}

/** Maps the CSS weight scale onto Compose weights. */
fun weight(css: Int): FontWeight = FontWeight(css.coerceIn(100, 900))

fun textStyle(style: BrambleTypeStyle, weight: Int = BrambleWeight.regular, tracking: Float = 0f, mono: Boolean = false) =
    TextStyle(
        fontSize = style.size,
        lineHeight = style.size * style.lineHeight,
        fontWeight = weight(weight),
        letterSpacing = tracking.em,
        fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
    )
