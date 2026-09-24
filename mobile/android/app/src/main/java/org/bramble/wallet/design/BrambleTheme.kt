package org.bramble.wallet.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
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

/** Derived surface tokens, restating the extension's `color-mix()` formulas. */
val BrambleSkin.accentSoft: Color get() = lerp(panel, accent, 0.13f)
val BrambleSkin.hairline: Color get() = text.copy(alpha = 0.12f)
val BrambleSkin.avatars: List<Color> get() = listOf(accountAvatar0, accountAvatar1, accountAvatar2, accountAvatar3)

val LocalSkin = staticCompositionLocalOf { BrambleSkins.daylight }

/** Picks daylight or midnight from the system appearance, as the extension's `theme.ts` does. */
@Composable
fun BrambleTheme(content: @Composable () -> Unit) {
    val skin = if (isSystemInDarkTheme()) BrambleSkins.midnight else BrambleSkins.daylight
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
