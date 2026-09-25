import BrambleCore
import SwiftUI

/// The extension's Beam avatar, drawn from the geometry the Rust core computes
/// (`account_avatar`, parity-tested against `account-avatar.ts`).
struct AccountAvatarView: View {
    @Environment(\.skin) private var skin
    let address: String
    var size: CGFloat = BrambleSize.avatar

    var body: some View {
        let spec = accountAvatar(address: address)
        let ink = spec.faceInkIsPaper ? skin.accountAvatarPaper : skin.accountAvatarInk
        Canvas { context, canvasSize in
            let unit = canvasSize.width / AvatarGeometry.canvas
            context.scaleBy(x: unit, y: unit)
            context.fill(
                Path(AvatarGeometry.canvasRect),
                with: .color(skin.avatars[Int(spec.backgroundTone)])
            )

            var head = context
            head.translateBy(x: spec.wrapperTranslateX, y: spec.wrapperTranslateY)
            head.rotate(degrees: spec.wrapperRotate, aroundCentre: AvatarGeometry.centre)
            head.scaleBy(x: spec.wrapperScale, y: spec.wrapperScale)
            head.fill(
                Path(
                    roundedRect: AvatarGeometry.canvasRect,
                    cornerRadius: min(spec.wrapperCornerRadius, AvatarGeometry.maxWrapperCornerRadius)
                ),
                with: .color(skin.avatars[Int(spec.wrapperTone)])
            )

            var face = context
            face.translateBy(x: spec.faceTranslateX, y: spec.faceTranslateY)
            face.rotate(degrees: spec.faceRotate, aroundCentre: AvatarGeometry.centre)
            let mouthY = AvatarGeometry.mouthBaselineY + spec.mouthSpread
            if spec.mouthOpen {
                Self.strokeOpenMouth(in: &face, mouthY: mouthY, ink: ink)
            } else {
                Self.fillClosedMouth(in: &face, mouthY: mouthY, ink: ink)
            }
            for eyeX in [AvatarGeometry.leftEyeX - spec.eyeSpread, AvatarGeometry.rightEyeX + spec.eyeSpread] {
                face.fill(
                    Path(
                        roundedRect: CGRect(
                            x: eyeX,
                            y: AvatarGeometry.eyeY,
                            width: AvatarGeometry.eyeWidth,
                            height: AvatarGeometry.eyeHeight
                        ),
                        cornerRadius: AvatarGeometry.eyeCornerRadius
                    ),
                    with: .color(ink)
                )
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    /// The open mouth: a one-unit round-capped curve from 15 to 21 that dips one unit below `mouthY`.
    nonisolated private static func strokeOpenMouth(in face: inout GraphicsContext, mouthY: Double, ink: Color) {
        let controlY = mouthY + AvatarGeometry.openMouthDip
        var mouth = Path()
        mouth.move(to: CGPoint(x: AvatarGeometry.openMouthStartX, y: mouthY))
        mouth.addCurve(
            to: CGPoint(x: AvatarGeometry.openMouthEndX, y: mouthY),
            control1: CGPoint(x: AvatarGeometry.openMouthControl1X, y: controlY),
            control2: CGPoint(x: AvatarGeometry.openMouthControl2X, y: controlY)
        )
        face.stroke(
            mouth,
            with: .color(ink),
            style: StrokeStyle(lineWidth: AvatarGeometry.openMouthLineWidth, lineCap: .round)
        )
    }

    /// `M13 y a1 .75 0 0 0 10 0`: the radii scale up to span 13…23, so the mouth is the lower half
    /// of a 10 × 7.5 ellipse, filled.
    nonisolated private static func fillClosedMouth(in face: inout GraphicsContext, mouthY: Double, ink: Color) {
        let ellipse = Path(
            ellipseIn: CGRect(
                x: AvatarGeometry.closedMouthX,
                y: mouthY - AvatarGeometry.closedMouthHalfHeight,
                width: AvatarGeometry.closedMouthWidth,
                height: AvatarGeometry.closedMouthHeight
            )
        )
        let lowerHalf = Path(
            CGRect(
                x: AvatarGeometry.closedMouthX,
                y: mouthY,
                width: AvatarGeometry.closedMouthWidth,
                height: AvatarGeometry.closedMouthClipHeight
            )
        )
        face.fill(ellipse.intersection(lowerHalf), with: .color(ink))
    }
}

/// The Beam avatar's fixed geometry, in units of its 36 × 36 SVG canvas (`account-avatar.ts`).
private enum AvatarGeometry {
    /// Side of the square SVG canvas; the view scales one canvas unit to `width / canvas` points.
    static let canvas: CGFloat = 36
    /// The canvas, as a rect at the origin.
    static let canvasRect = CGRect(x: 0, y: 0, width: canvas, height: canvas)
    /// Centre of the canvas on both axes: the pivot of the SVG `rotate(a 18 18)`.
    static let centre: CGFloat = 18
    /// The wrapper's corner radius is capped at half the canvas (a circle).
    static let maxWrapperCornerRadius: Double = 18
    /// Mouth baseline before the address-derived `mouthSpread` is added.
    static let mouthBaselineY: Double = 19
    static let openMouthStartX: CGFloat = 15
    static let openMouthEndX: CGFloat = 21
    static let openMouthControl1X: CGFloat = 17
    static let openMouthControl2X: CGFloat = 19
    /// How far the open mouth's curve controls sit below the baseline.
    static let openMouthDip: Double = 1
    static let openMouthLineWidth: CGFloat = 1
    static let closedMouthX: CGFloat = 13
    static let closedMouthWidth: CGFloat = 10
    /// Full height of the ellipse whose lower half is the closed mouth.
    static let closedMouthHeight: CGFloat = 7.5
    /// Half of `closedMouthHeight`: the ellipse is centred on the baseline.
    static let closedMouthHalfHeight: Double = 3.75
    /// Height of the clip rect below the baseline that keeps only the ellipse's lower half.
    static let closedMouthClipHeight: CGFloat = 4
    /// Eye x positions before the address-derived `eyeSpread` moves them apart.
    static let leftEyeX: Double = 14
    static let rightEyeX: Double = 20
    static let eyeY: CGFloat = 14
    static let eyeWidth: CGFloat = 1.5
    static let eyeHeight: CGFloat = 2
    static let eyeCornerRadius: CGFloat = 0.75
}

private extension GraphicsContext {
    /// SVG `rotate(a cx cy)` with cx = cy.
    mutating func rotate(degrees: Double, aroundCentre centre: CGFloat) {
        translateBy(x: centre, y: centre)
        rotate(by: .degrees(degrees))
        translateBy(x: -centre, y: -centre)
    }
}
