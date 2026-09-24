package org.bramble.wallet.design

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.toArgb

/**
 * The extension's `box-shadow: 0 <y> <blur> rgba(0,0,0,<alpha>)`, which `Modifier.shadow`
 * (an elevation model) cannot express. Draws the shape's outline with a transparent paint that
 * casts a shadow layer: CSS blur is 2σ and the Android shadow radius is σ, so the radius is
 * blur / 2, the same conversion iOS `brambleShadow` makes. Hardware-accelerated shadow layers
 * work from API 28, the minimum SDK. Put it before the modifier that fills the shape, so the fill
 * covers the part of the shadow under it.
 */
fun Modifier.brambleShadow(
    style: BrambleShadowStyle,
    shape: Shape,
): Modifier =
    drawBehind {
        val outline = shape.createOutline(size, layoutDirection, this)
        val paint = Paint()
        paint.asFrameworkPaint().apply {
            isAntiAlias = true
            color = android.graphics.Color.TRANSPARENT
            setShadowLayer(style.blur.toPx() / 2f, 0f, style.y.toPx(), Color.Black.copy(alpha = style.alpha).toArgb())
        }
        drawIntoCanvas { canvas ->
            when (outline) {
                is Outline.Rectangle -> {
                    canvas.drawRect(outline.rect, paint)
                }

                is Outline.Rounded -> {
                    canvas.drawPath(
                        androidx.compose.ui.graphics.Path().apply {
                            addRoundRect(outline.roundRect)
                        },
                        paint,
                    )
                }

                is Outline.Generic -> {
                    canvas.drawPath(outline.path, paint)
                }
            }
        }
    }
