package org.bramble.wallet.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.unit.Dp
import org.bramble.core.accountAvatar

/** The avatar's SVG viewport (`account-avatar.ts` draws on a 36-unit square). */
private const val VIEWPORT = 36f
private const val CENTRE = VIEWPORT / 2

// Face geometry in viewport units, from the paths `account-avatar.ts` draws.

/** Mouth baseline before the core's `mouthSpread` offset. */
private const val MOUTH_BASE_Y = 19

/** Open mouth `M15 y c2 1 4 1 6 0`: start, the two control points, and end on x. */
private const val OPEN_MOUTH_START_X = 15f
private const val OPEN_MOUTH_CONTROL_ONE_X = 17f
private const val OPEN_MOUTH_CONTROL_TWO_X = 19f
private const val OPEN_MOUTH_END_X = 21f

/** Closed mouth: the lower half of a 10 × 7.5 ellipse spanning x 13…23. */
private const val CLOSED_MOUTH_LEFT = 13f
private const val CLOSED_MOUTH_RIGHT = 23f
private const val CLOSED_MOUTH_WIDTH = 10f
private const val CLOSED_MOUTH_HEIGHT = 7.5f
private const val CLOSED_MOUTH_HALF_HEIGHT = 3.75f
private const val CLOSED_MOUTH_CLIP_DEPTH = 4

/** Eyes: x of each before `eyeSpread`, their top, size, and corner radii. */
private const val LEFT_EYE_X = 14
private const val RIGHT_EYE_X = 20
private const val EYE_TOP = 14f
private const val EYE_WIDTH = 1.5f
private const val EYE_HEIGHT = 2f
private const val EYE_CORNER_X = 0.75f
private const val EYE_CORNER_Y = 1f

/**
 * The extension's Beam avatar, port of the iOS `AccountAvatarView`. Every number comes from the
 * Rust core's `account_avatar` (parity-tested against `account-avatar.ts`); Kotlin only draws.
 * Decorative: the account name next to it carries the meaning.
 */
@Composable
fun AccountAvatar(
    address: String,
    size: Dp = BrambleSize.avatar,
) {
    val skin = LocalSkin.current
    val spec = remember(address) { accountAvatar(address) }
    val ink = if (spec.faceInkIsPaper) skin.accountAvatarPaper else skin.accountAvatarInk
    Canvas(Modifier.size(size).clip(CircleShape)) {
        val unit = this.size.width / VIEWPORT
        scale(unit, unit, pivot = Offset.Zero) {
            drawRect(skin.avatars[spec.backgroundTone.toInt()], size = Size(VIEWPORT, VIEWPORT))
            withTransform({
                translate(spec.wrapperTranslateX.toFloat(), spec.wrapperTranslateY.toFloat())
                rotate(spec.wrapperRotate.toFloat(), pivot = Offset(CENTRE, CENTRE))
                scale(spec.wrapperScale.toFloat(), spec.wrapperScale.toFloat(), pivot = Offset.Zero)
            }) {
                val radius = minOf(spec.wrapperCornerRadius.toFloat(), CENTRE)
                drawRoundRect(
                    skin.avatars[spec.wrapperTone.toInt()],
                    size = Size(VIEWPORT, VIEWPORT),
                    cornerRadius = CornerRadius(radius, radius),
                )
            }
            withTransform({
                translate(spec.faceTranslateX.toFloat(), spec.faceTranslateY.toFloat())
                rotate(spec.faceRotate.toFloat(), pivot = Offset(CENTRE, CENTRE))
            }) {
                drawFace(spec.mouthOpen, (MOUTH_BASE_Y + spec.mouthSpread).toFloat(), spec.eyeSpread.toFloat(), ink)
            }
        }
    }
}

private fun DrawScope.drawFace(
    mouthOpen: Boolean,
    mouthY: Float,
    eyeSpread: Float,
    ink: androidx.compose.ui.graphics.Color,
) {
    if (mouthOpen) {
        // `M15 y c2 1 4 1 6 0`, stroked 1 unit with a round cap.
        val mouth =
            Path().apply {
                moveTo(OPEN_MOUTH_START_X, mouthY)
                cubicTo(
                    OPEN_MOUTH_CONTROL_ONE_X,
                    mouthY + 1,
                    OPEN_MOUTH_CONTROL_TWO_X,
                    mouthY + 1,
                    OPEN_MOUTH_END_X,
                    mouthY,
                )
            }
        drawPath(mouth, ink, style = Stroke(width = 1f, cap = StrokeCap.Round))
    } else {
        // `M13 y a1 .75 0 0 0 10 0`: the radii scale up to span 13…23, so the mouth is the lower
        // half of a 10 × 7.5 ellipse, filled.
        clipRect(
            left = CLOSED_MOUTH_LEFT,
            top = mouthY,
            right = CLOSED_MOUTH_RIGHT,
            bottom = mouthY + CLOSED_MOUTH_CLIP_DEPTH,
        ) {
            drawOval(
                ink,
                topLeft = Offset(CLOSED_MOUTH_LEFT, mouthY - CLOSED_MOUTH_HALF_HEIGHT),
                size = Size(CLOSED_MOUTH_WIDTH, CLOSED_MOUTH_HEIGHT),
            )
        }
    }
    for (x in listOf(LEFT_EYE_X - eyeSpread, RIGHT_EYE_X + eyeSpread)) {
        drawRoundRect(
            ink,
            topLeft = Offset(x, EYE_TOP),
            size = Size(EYE_WIDTH, EYE_HEIGHT),
            cornerRadius = CornerRadius(EYE_CORNER_X, EYE_CORNER_Y),
        )
    }
}
