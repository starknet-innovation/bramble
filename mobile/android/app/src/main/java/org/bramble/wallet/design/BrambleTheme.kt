package org.bramble.wallet.design

import androidx.compose.animation.core.tween
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
// Nothing here restates a value: it only adapts the generated tokens to Compose.

data class BrambleTypeStyle(val size: TextUnit, val lineHeight: Float)
data class BrambleSpringSpec(val response: Float, val damping: Float)
data class BrambleShadowStyle(val y: Dp, val blur: Dp, val alpha: Float)

val BrambleSkin.avatars: List<Color> get() = listOf(accountAvatar0, accountAvatar1, accountAvatar2, accountAvatar3)

/**
 * The extension's `ThemeChoice`: dark (midnight) by default, or light (daylight). There is no
 * follow-the-system option, matching the extension (system neutrals broke its surface tiers).
 * Persisted as the non-secret preference `theme` = `"dark"` | `"light"`.
 */
enum class ThemeChoice(val stored: String) {
    DARK("dark"),
    LIGHT("light");

    companion object {
        const val STORAGE_KEY = "theme"

        /** Absent or unknown values fall back to dark, as a fresh install does. */
        fun fromStored(value: String?): ThemeChoice = if (value == LIGHT.stored) LIGHT else DARK
    }
}

/** Dark (midnight) is the default, including anywhere outside `BrambleTheme`. */
val LocalSkin = staticCompositionLocalOf { BrambleSkins.midnight }
val LocalThemeChoice = staticCompositionLocalOf { ThemeChoice.DARK }

/** Applies the chosen skin; midnight unless the person picked light. */
@Composable
fun BrambleTheme(choice: ThemeChoice = ThemeChoice.DARK, content: @Composable () -> Unit) {
    val skin = if (choice == ThemeChoice.LIGHT) BrambleSkins.daylight else BrambleSkins.midnight
    CompositionLocalProvider(LocalSkin provides skin, LocalThemeChoice provides choice, content = content)
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

/** A tween on one of the generated eases and durations, as iOS `BrambleBezier.animation(ms:)`. */
fun <T> brambleTween(ms: Int, easing: androidx.compose.animation.core.Easing = BrambleEase.out) =
    tween<T>(durationMillis = ms, easing = easing)
