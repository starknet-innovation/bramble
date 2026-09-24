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
            let unit = canvasSize.width / 36
            context.scaleBy(x: unit, y: unit)
            context.fill(Path(CGRect(x: 0, y: 0, width: 36, height: 36)), with: .color(skin.avatars[Int(spec.backgroundTone)]))

            var head = context
            head.translateBy(x: spec.wrapperTranslateX, y: spec.wrapperTranslateY)
            head.rotate(degrees: spec.wrapperRotate, aroundCentre: 18)
            head.scaleBy(x: spec.wrapperScale, y: spec.wrapperScale)
            head.fill(
                Path(roundedRect: CGRect(x: 0, y: 0, width: 36, height: 36), cornerRadius: min(spec.wrapperCornerRadius, 18)),
                with: .color(skin.avatars[Int(spec.wrapperTone)])
            )

            var face = context
            face.translateBy(x: spec.faceTranslateX, y: spec.faceTranslateY)
            face.rotate(degrees: spec.faceRotate, aroundCentre: 18)
            let mouthY = 19 + spec.mouthSpread
            if spec.mouthOpen {
                var mouth = Path()
                mouth.move(to: CGPoint(x: 15, y: mouthY))
                mouth.addCurve(to: CGPoint(x: 21, y: mouthY), control1: CGPoint(x: 17, y: mouthY + 1), control2: CGPoint(x: 19, y: mouthY + 1))
                face.stroke(mouth, with: .color(ink), style: StrokeStyle(lineWidth: 1, lineCap: .round))
            } else {
                // `M13 y a1 .75 0 0 0 10 0`: the radii scale up to span 13…23, so the mouth is the
                // lower half of a 10 × 7.5 ellipse, filled.
                let ellipse = Path(ellipseIn: CGRect(x: 13, y: mouthY - 3.75, width: 10, height: 7.5))
                face.fill(ellipse.intersection(Path(CGRect(x: 13, y: mouthY, width: 10, height: 4))), with: .color(ink))
            }
            for x in [14 - spec.eyeSpread, 20 + spec.eyeSpread] {
                face.fill(Path(roundedRect: CGRect(x: x, y: 14, width: 1.5, height: 2), cornerRadius: 0.75), with: .color(ink))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

private extension GraphicsContext {
    /// SVG `rotate(a cx cy)` with cx = cy.
    mutating func rotate(degrees: Double, aroundCentre centre: CGFloat) {
        translateBy(x: centre, y: centre)
        rotate(by: .degrees(degrees))
        translateBy(x: -centre, y: -centre)
    }
}
