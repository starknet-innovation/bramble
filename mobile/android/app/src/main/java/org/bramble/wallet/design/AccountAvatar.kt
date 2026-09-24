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

/**
 * The extension's Beam avatar, port of the iOS `AccountAvatarView`. Every number comes from the
 * Rust core's `account_avatar` (parity-tested against `account-avatar.ts`); Kotlin only draws.
 * Decorative: the account name next to it carries the meaning.
 */
@Composable
fun AccountAvatar(address: String, size: Dp = BrambleSize.avatar) {
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
                drawRoundRect(skin.avatars[spec.wrapperTone.toInt()], size = Size(VIEWPORT, VIEWPORT), cornerRadius = CornerRadius(radius, radius))
            }
            withTransform({
                translate(spec.faceTranslateX.toFloat(), spec.faceTranslateY.toFloat())
                rotate(spec.faceRotate.toFloat(), pivot = Offset(CENTRE, CENTRE))
            }) {
                drawFace(spec.mouthOpen, (19 + spec.mouthSpread).toFloat(), spec.eyeSpread.toFloat(), ink)
            }
        }
    }
}

private fun DrawScope.drawFace(mouthOpen: Boolean, mouthY: Float, eyeSpread: Float, ink: androidx.compose.ui.graphics.Color) {
    if (mouthOpen) {
        // `M15 y c2 1 4 1 6 0`, stroked 1 unit with a round cap.
        val mouth = Path().apply {
            moveTo(15f, mouthY)
            cubicTo(17f, mouthY + 1, 19f, mouthY + 1, 21f, mouthY)
        }
        drawPath(mouth, ink, style = Stroke(width = 1f, cap = StrokeCap.Round))
    } else {
        // `M13 y a1 .75 0 0 0 10 0`: the radii scale up to span 13…23, so the mouth is the lower
        // half of a 10 × 7.5 ellipse, filled.
        clipRect(left = 13f, top = mouthY, right = 23f, bottom = mouthY + 4) {
            drawOval(ink, topLeft = Offset(13f, mouthY - 3.75f), size = Size(10f, 7.5f))
        }
    }
    for (x in listOf(14 - eyeSpread, 20 + eyeSpread)) {
        drawRoundRect(ink, topLeft = Offset(x, 14f), size = Size(1.5f, 2f), cornerRadius = CornerRadius(0.75f, 1f))
    }
}

