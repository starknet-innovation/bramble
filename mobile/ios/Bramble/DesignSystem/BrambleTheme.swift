import SwiftUI

// Hand-written companions to BrambleTokens.generated.swift. Every value on screen comes from a
// generated token or from one of the derived mixes below, which restate the extension's
// `color-mix()` formulas in `wallet-ui/src/sidepanel/styles` — never from a literal colour.

extension Color {
    /// A colour from a 24-bit `0xRRGGBB` token.
    init(rgb: UInt32) {
        self.init(
            .sRGB,
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255,
            opacity: 1
        )
    }

    /// `color-mix(in srgb, self pct%, other)`.
    func mixed(_ fraction: Double, over other: Color) -> Color {
        let a = UIColor(self).rgba, b = UIColor(other).rgba
        return Color(
            .sRGB,
            red: a.r * fraction + b.r * (1 - fraction),
            green: a.g * fraction + b.g * (1 - fraction),
            blue: a.b * fraction + b.b * (1 - fraction),
            opacity: a.a * fraction + b.a * (1 - fraction)
        )
    }
}

private extension UIColor {
    var rgba: (r: Double, g: Double, b: Double, a: Double) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b), Double(a))
    }
}

/// Derived surface tokens, as in `styles-base.ts` / `styles-tokens.ts`.
extension BrambleSkin {
    var accentSoft: Color { accent.mixed(0.13, over: panel) }
    var hover: Color { text.mixed(0.06, over: elevated) }
    var softPress: Color { text.mixed(0.11, over: elevated) }
    var hairline: Color { text.opacity(0.12) }
    var avatars: [Color] { [accountAvatar0, accountAvatar1, accountAvatar2, accountAvatar3] }
}

struct BrambleTypeStyle {
    let size: CGFloat
    let lineHeight: CGFloat
}

struct BrambleBezier {
    let c0x: Double, c0y: Double, c1x: Double, c1y: Double
    init(_ c0x: Double, _ c0y: Double, _ c1x: Double, _ c1y: Double) {
        (self.c0x, self.c0y, self.c1x, self.c1y) = (c0x, c0y, c1x, c1y)
    }

    func animation(ms: Double) -> Animation {
        .timingCurve(c0x, c0y, c1x, c1y, duration: ms / 1000)
    }
}

struct BrambleShadowStyle {
    let y: CGFloat
    let blur: CGFloat
    let alpha: Double
}

enum BrambleFont {
    /// Maps the CSS weight scale onto SwiftUI weights.
    static func weight(_ css: Int) -> Font.Weight {
        switch css {
        case ..<500: .regular
        case ..<700: .semibold
        case ..<800: .bold
        default: .heavy
        }
    }

    static func ui(_ style: BrambleTypeStyle, weight css: Int = BrambleWeight.regular) -> Font {
        .system(size: style.size, weight: weight(css))
    }

    static func mono(_ style: BrambleTypeStyle, weight css: Int = BrambleWeight.regular) -> Font {
        .system(size: style.size, weight: weight(css), design: .monospaced)
    }
}

private struct SkinKey: EnvironmentKey {
    static let defaultValue = BrambleSkin.daylight
}

extension EnvironmentValues {
    var skin: BrambleSkin {
        get { self[SkinKey.self] }
        set { self[SkinKey.self] = newValue }
    }
}

extension View {
    /// Applies a type style with the token's line height and tracking (em × size).
    func brambleText(_ style: BrambleTypeStyle, weight: Int = BrambleWeight.regular, tracking: CGFloat = 0, mono: Bool = false) -> some View {
        font(mono ? BrambleFont.mono(style, weight: weight) : BrambleFont.ui(style, weight: weight))
            .lineSpacing(style.size * (style.lineHeight - 1))
            .tracking(style.size * tracking)
    }

    func brambleShadow(_ style: BrambleShadowStyle) -> some View {
        shadow(color: .black.opacity(style.alpha), radius: style.blur / 2, x: 0, y: style.y)
    }
}

/// Picks daylight or midnight from the system appearance, as the extension's `theme.ts` does.
struct SkinProvider<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    @ViewBuilder let content: () -> Content

    var body: some View {
        let skin = scheme == .dark ? BrambleSkin.midnight : BrambleSkin.daylight
        content()
            .environment(\.skin, skin)
            .tint(skin.accent)
            .background(skin.bg.ignoresSafeArea())
    }
}
