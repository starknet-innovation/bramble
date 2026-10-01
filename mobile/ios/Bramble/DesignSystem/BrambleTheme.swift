import SwiftUI

// Hand-written companions to BrambleTokens.generated.swift. Every colour on screen is a generated
// skin field (base or derived); every size is a generated scale token or stylesheet metric.
// Nothing here restates a value: it only adapts the tokens to SwiftUI.

extension Color {
    /// A colour from a generated `0xAARRGGBB` token.
    init(argb: UInt32) {
        self.init(
            .sRGB,
            red: Self.channel(argb, shift: ARGBLayout.redShift),
            green: Self.channel(argb, shift: ARGBLayout.greenShift),
            blue: Self.channel(argb, shift: ARGBLayout.blueShift),
            opacity: Self.channel(argb, shift: ARGBLayout.alphaShift)
        )
    }

    /// One 8-bit channel of a packed `0xAARRGGBB` value, as a 0…1 component.
    private static func channel(_ argb: UInt32, shift: UInt32) -> Double {
        Double((argb >> shift) & ARGBLayout.channelMask) / ARGBLayout.channelMax
    }
}

/// Bit layout of a packed `0xAARRGGBB` colour token.
private enum ARGBLayout {
    static let alphaShift: UInt32 = 24
    static let redShift: UInt32 = 16
    static let greenShift: UInt32 = 8
    static let blueShift: UInt32 = 0
    static let channelMask: UInt32 = 0xFF
    static let channelMax: Double = 255
}

extension BrambleSkin {
    var avatars: [Color] { [accountAvatar0, accountAvatar1, accountAvatar2, accountAvatar3] }
}

struct BrambleTypeStyle {
    let size: CGFloat
    let lineHeight: CGFloat

    /// The same line height at another size, for a stylesheet rule that only changes the size.
    func sized(_ size: CGFloat) -> Self { Self(size: size, lineHeight: lineHeight) }
}

struct BrambleBezier {
    let c0x: Double, c0y: Double, c1x: Double, c1y: Double

    init(_ c0x: Double, _ c0y: Double, _ c1x: Double, _ c1y: Double) {
        (self.c0x, self.c0y, self.c1x, self.c1y) = (c0x, c0y, c1x, c1y)
    }

    private static let millisecondsPerSecond: Double = 1_000

    func animation(ms milliseconds: Double) -> Animation {
        .timingCurve(c0x, c0y, c1x, c1y, duration: milliseconds / Self.millisecondsPerSecond)
    }
}

struct BrambleShadowStyle: Equatable {
    let offsetY: CGFloat
    let blur: CGFloat
    let alpha: Double

    /// The generated tokens' shape (`y`, `blur`, `alpha`), as the extension's `box-shadow` values.
    init(y offsetY: CGFloat, blur: CGFloat, alpha: Double) {
        self.offsetY = offsetY
        self.blur = blur
        self.alpha = alpha
    }
}

private struct SkinKey: EnvironmentKey {
    /// Dark is the default everywhere, including views presented outside a `SkinProvider`.
    static let defaultValue = BrambleSkin.midnight
}

extension EnvironmentValues {
    var skin: BrambleSkin {
        get { self[SkinKey.self] }
        set { self[SkinKey.self] = newValue }
    }
}

/// A CSS blur radius spans two Gaussian standard deviations; SwiftUI's shadow radius is one.
private let cssBlurSigmas: CGFloat = 2

extension View {
    /// Casts a component's generated elevation (`BrambleElevation.*`); nil casts nothing. CSS blur
    /// is two Gaussian sigmas, so the SwiftUI radius is half the token's blur.
    func elevation(_ style: BrambleShadowStyle?) -> some View {
        shadow(
            color: .black.opacity(style?.alpha ?? 0),
            radius: (style?.blur ?? 0) / cssBlurSigmas,
            x: 0,
            y: style?.offsetY ?? 0
        )
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
    static let `default` = Self.dark

    /// A stored value as a choice: unset, legacy `system`, or anything unknown is dark, as the
    /// extension resolves it. `@AppStorage` applies the same rule through its default.
    static func resolve(_ raw: String?) -> Self {
        raw.flatMap(Self.init(rawValue:)) ?? .default
    }
}

/// Applies the chosen skin (`skinForChoice`) and pins the matching system colour scheme.
struct SkinProvider<Content: View>: View {
    @AppStorage(ThemeChoice.storageKey) private var theme = ThemeChoice.default
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
