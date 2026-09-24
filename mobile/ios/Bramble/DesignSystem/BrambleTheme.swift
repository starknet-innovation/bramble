import SwiftUI

// Hand-written companions to BrambleTokens.generated.swift. Every colour on screen is a generated
// skin field (base or derived); every size is a generated scale token or stylesheet metric.
// Nothing here restates a value: it only adapts the tokens to SwiftUI.

extension Color {
    /// A colour from a generated `0xAARRGGBB` token.
    init(argb: UInt32) {
        self.init(
            .sRGB,
            red: Double((argb >> 16) & 0xFF) / 255,
            green: Double((argb >> 8) & 0xFF) / 255,
            blue: Double(argb & 0xFF) / 255,
            opacity: Double((argb >> 24) & 0xFF) / 255
        )
    }
}

extension BrambleSkin {
    var avatars: [Color] { [accountAvatar0, accountAvatar1, accountAvatar2, accountAvatar3] }
}

struct BrambleTypeStyle {
    let size: CGFloat
    let lineHeight: CGFloat

    /// The same line height at another size, for a stylesheet rule that only changes the size.
    func sized(_ size: CGFloat) -> BrambleTypeStyle { BrambleTypeStyle(size: size, lineHeight: lineHeight) }
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

struct BrambleShadowStyle: Equatable {
    let y: CGFloat
    let blur: CGFloat
    let alpha: Double
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
    /// Casts a component's generated elevation (`BrambleElevation.*`); nil casts nothing. CSS blur
    /// is two Gaussian sigmas, so the SwiftUI radius is half the token's blur.
    func elevation(_ style: BrambleShadowStyle?) -> some View {
        shadow(color: .black.opacity(style?.alpha ?? 0), radius: (style?.blur ?? 0) / 2, x: 0, y: style?.y ?? 0)
    }
}

/// One of the extension's stroke icons, tinted by the foreground style.
struct BrambleIcon: View {
    let name: BrambleIconName
    var size: CGFloat = BrambleControl.icon

    init(_ name: BrambleIconName, size: CGFloat = BrambleControl.icon) {
        self.name = name
        self.size = size
    }

    var body: some View {
        Image(name.rawValue)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The wallet's theme choice, as the extension's `ThemeChoice`: dark (midnight) by default, or
/// light (daylight). There is deliberately no follow-the-system option — the extension removed it
/// because system neutrals broke the designed surface tiers.
enum ThemeChoice: String {
    case dark, light

    static let storageKey = "theme"
}

/// Applies the chosen skin (`skinForChoice`) and pins the matching system colour scheme.
struct SkinProvider<Content: View>: View {
    @AppStorage(ThemeChoice.storageKey) private var theme = ThemeChoice.dark
    @ViewBuilder let content: () -> Content

    var body: some View {
        let skin = theme == .light ? BrambleSkin.daylight : BrambleSkin.midnight
        content()
            .environment(\.skin, skin)
            .tint(skin.accent)
            .foregroundStyle(skin.text)
            .preferredColorScheme(theme == .light ? .light : .dark)
            .sensoryFeedback(.selection, trigger: theme)
    }
}
