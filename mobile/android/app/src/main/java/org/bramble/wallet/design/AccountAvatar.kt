package org.bramble.wallet.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import org.bramble.core.AccountAvatar
import org.bramble.core.AvatarPaint
import org.bramble.core.AvatarPart
import org.bramble.core.AvatarShape
import org.bramble.core.accountAvatar

/** The bird's SVG viewport (`account-avatar.ts` draws on a 36-unit square). */
private const val VIEWPORT = 36f
private const val CENTRE = VIEWPORT / 2

/**
 * The account bird, painted from the parts the Rust core decides (`account_avatar`, parity-tested
 * against `account-avatar.ts`); Kotlin only paints. Path data is the core's absolute `M`, `L`,
 * `Q`, `V`, `Z` subset, parsed by Compose. Decorative: the account name next to it carries the
 * meaning.
 */
@Composable
fun AccountAvatar(
    address: String,
    size: Dp = BrambleSize.avatar,
) {
    val skin = LocalSkin.current
    val bird = remember(address) { accountAvatar(address) }
    Canvas(Modifier.size(size).clip(CircleShape)) {
        val unit = this.size.width / VIEWPORT
        scale(unit, unit, pivot = Offset.Zero) {
            drawRect(skin.avatarGrounds[bird.groundTone.toInt()], size = Size(VIEWPORT, VIEWPORT))
            withTransform({
                if (bird.mirrored) scale(-1f, 1f, pivot = Offset(CENTRE, CENTRE))
                translate(CENTRE, CENTRE)
                scale(bird.scale.toFloat(), bird.scale.toFloat(), pivot = Offset.Zero)
                translate(-bird.originX.toFloat(), -bird.originY.toFloat())
            }) {
                for (part in bird.parts) {
                    drawPart(part, skin.avatarColour(part.paint, bird).copy(alpha = part.opacity.toFloat()))
                }
            }
        }
    }
}

private fun BrambleSkin.avatarColour(
    paint: AvatarPaint,
    bird: AccountAvatar,
): Color =
    when (paint) {
        AvatarPaint.GROUND -> avatarGrounds[bird.groundTone.toInt()]
        AvatarPaint.BODY -> avatarBodies[bird.bodyTone.toInt()]
        AvatarPaint.ACCENT -> avatarAccents[bird.accentTone.toInt()]
        AvatarPaint.INK -> accountAvatarInk
        AvatarPaint.PAPER -> accountAvatarPaper
    }

private fun DrawScope.drawPart(
    part: AvatarPart,
    colour: Color,
) {
    when (val shape = part.shape) {
        is AvatarShape.Fill -> {
            drawPath(PathParser().parsePathString(shape.d).toPath(), colour)
        }

        is AvatarShape.Stroke -> {
            drawPath(
                PathParser().parsePathString(shape.d).toPath(),
                colour,
                style = Stroke(width = shape.width.toFloat(), cap = StrokeCap.Round),
            )
        }

        is AvatarShape.Ellipse -> {
            val centre = Offset(shape.cx.toFloat(), shape.cy.toFloat())
            rotate(shape.rotate.toFloat(), pivot = centre) {
                drawOval(
                    colour,
                    topLeft = Offset((shape.cx - shape.rx).toFloat(), (shape.cy - shape.ry).toFloat()),
                    size = Size((shape.rx * 2).toFloat(), (shape.ry * 2).toFloat()),
                )
            }
        }

        is AvatarShape.Circle -> {
            drawCircle(colour, radius = shape.r.toFloat(), center = Offset(shape.cx.toFloat(), shape.cy.toFloat()))
        }
    }
}
