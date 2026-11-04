import BrambleCore
import SwiftUI

/// The account bird, painted from the parts the Rust core decides (`account_avatar`,
/// parity-tested against `account-avatar.ts`). Swift only paints; every part and number is the
/// core's. Decorative: the account name next to it carries the meaning.
struct AccountAvatarView: View {
    @Environment(\.skin) private var skin
    let address: String
    var size: CGFloat = BrambleSize.avatar

    var body: some View {
        let bird = accountAvatar(address: address)
        Canvas { context, canvasSize in
            let unit = canvasSize.width / AvatarCanvas.side
            context.scaleBy(x: unit, y: unit)
            context.fill(Path(AvatarCanvas.rect), with: .color(colour(.ground, of: bird)))

            var drawing = context
            if bird.mirrored { drawing.concatenate(AvatarCanvas.mirror) }
            drawing.translateBy(x: AvatarCanvas.centre, y: AvatarCanvas.centre)
            drawing.scaleBy(x: bird.scale, y: bird.scale)
            drawing.translateBy(x: -bird.originX, y: -bird.originY)
            for part in bird.parts {
                paint(part, colour: colour(part.paint, of: bird).opacity(part.opacity), in: &drawing)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private func colour(_ paint: AvatarPaint, of bird: AccountAvatar) -> Color {
        switch paint {
        case .ground:
            skin.avatarGrounds[Int(bird.groundTone)]

        case .body:
            skin.avatarBodies[Int(bird.bodyTone)]

        case .accent:
            skin.avatarAccents[Int(bird.accentTone)]

        case .ink:
            skin.accountAvatarInk

        case .paper:
            skin.accountAvatarPaper
        }
    }

    private func paint(_ part: AvatarPart, colour: Color, in context: inout GraphicsContext) {
        switch part.shape {
        case let .fill(data):
            context.fill(AvatarPath.parse(data), with: .color(colour))

        case let .stroke(data, width):
            context.stroke(
                AvatarPath.parse(data),
                with: .color(colour),
                style: StrokeStyle(lineWidth: width, lineCap: .round)
            )

        case let .ellipse(centreX, centreY, radiusX, radiusY, rotate):
            let oval = Path(ellipseIn: AvatarCanvas.box(centreX, centreY, radiusX, radiusY))
            let turn = CGAffineTransform(translationX: centreX, y: centreY)
                .rotated(by: Angle.degrees(rotate).radians)
                .translatedBy(x: -centreX, y: -centreY)
            context.fill(oval.applying(turn), with: .color(colour))

        case let .circle(centreX, centreY, radius):
            context.fill(
                Path(ellipseIn: AvatarCanvas.box(centreX, centreY, radius, radius)),
                with: .color(colour)
            )
        }
    }
}

/// The 36-unit square every bird is drawn on (`viewBox="0 0 36 36"`).
private enum AvatarCanvas {
    static let side: CGFloat = 36
    static let centre: CGFloat = 18
    static let rect = CGRect(x: 0, y: 0, width: side, height: side)
    /// SVG `translate(36 0) scale(-1 1)`: the bird faces the other way.
    static let mirror = CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: side, ty: 0)

    /// The rect an ellipse of these radii fills, about its centre.
    static func box(_ centreX: Double, _ centreY: Double, _ radiusX: Double, _ radiusY: Double) -> CGRect {
        CGRect(origin: CGPoint(x: centreX, y: centreY), size: .zero).insetBy(dx: -radiusX, dy: -radiusY)
    }
}

/// The SVG path subset the core emits (absolute `M`, `L`, `Q`, `V`, `Z`; checked by the core's
/// `paths_use_only_the_commands_the_apps_draw`). Anything else is skipped rather than guessed.
enum AvatarPath {
    /// Numbers each command takes: a point (`M`, `L`), one coordinate (`V`), a control and a point (`Q`).
    private enum Arity {
        static let point = 2
        static let coordinate = 1
        static let quad = 4
    }

    static func parse(_ data: String) -> Path {
        var path = Path()
        var command: Character = "M"
        var numbers: [Double] = []
        var current = CGPoint.zero
        for token in tokens(data) {
            if let value = Double(token) {
                numbers.append(value)
            } else if let letter = token.first {
                command = letter
                numbers = []
                if letter == "Z" { path.closeSubpath() }
                continue
            }
            switch (command, numbers.count) {
            case ("M", Arity.point):
                current = CGPoint(x: numbers[0], y: numbers[1])
                path.move(to: current)
                command = "L"

            case ("L", Arity.point):
                current = CGPoint(x: numbers[0], y: numbers[1])
                path.addLine(to: current)

            case ("V", Arity.coordinate):
                current = CGPoint(x: current.x, y: numbers[0])
                path.addLine(to: current)

            case ("Q", Arity.quad):
                current = CGPoint(x: numbers[Arity.point], y: numbers[Arity.point + 1])
                path.addQuadCurve(to: current, control: CGPoint(x: numbers[0], y: numbers[1]))

            default:
                continue
            }
            numbers = []
        }
        return path
    }

    /// Splits `M9 19.5 L2.5 15` into `M`, `9`, `19.5`, `L`, `2.5`, `15`.
    private static func tokens(_ data: String) -> [String] {
        var tokens: [String] = []
        var number = ""
        for character in data {
            if character.isLetter {
                if !number.isEmpty { tokens.append(number) }
                number = ""
                tokens.append(String(character))
            } else if character == " " {
                if !number.isEmpty { tokens.append(number) }
                number = ""
            } else {
                number.append(character)
            }
        }
        if !number.isEmpty { tokens.append(number) }
        return tokens
    }
}
