import SwiftUI
import UIKit

// Type rendering for the generated TYPE tokens and stylesheet sizes: CSS weights (including 650,
// which SwiftUI's named weights cannot express), the CSS line box, and Dynamic Type.

enum BrambleTypography {
    /// UIKit's weight axis at each CSS hundred. Values between hundreds (the extension's 650) are
    /// interpolated linearly, so 650 renders between semibold and bold rather than as either.
    private static let axis: [(css: Double, ui: UIFont.Weight)] = [
        (CSSWeight.ultraLight, .ultraLight),
        (CSSWeight.thin, .thin),
        (CSSWeight.light, .light),
        (CSSWeight.regular, .regular),
        (CSSWeight.medium, .medium),
        (CSSWeight.semibold, .semibold),
        (CSSWeight.bold, .bold),
        (CSSWeight.heavy, .heavy),
        (CSSWeight.black, .black)
    ]

    /// The CSS `font-weight` keyword values at each hundred, the stops of `axis`.
    private enum CSSWeight {
        static let ultraLight: Double = 100
        static let thin: Double = 200
        static let light: Double = 300
        static let regular: Double = 400
        static let medium: Double = 500
        static let semibold: Double = 600
        static let bold: Double = 700
        static let heavy: Double = 800
        static let black: Double = 900
        /// The CSS weight range; values outside it are clamped.
        static let minimum = 100
        static let maximum = 900
    }

    /// Lower size bound (points, inclusive) of each Dynamic Type text-style band in `textStyle(for:)`.
    private enum TextStyleBand {
        static let largeTitle: CGFloat = 34
        static let title1: CGFloat = 26
        static let title2: CGFloat = 21
        static let title3: CGFloat = 18
        static let headline: CGFloat = 16
        static let body: CGFloat = 14
        static let footnote: CGFloat = 13
        static let caption1: CGFloat = 12
    }

    static func weight(_ css: Int) -> UIFont.Weight {
        let value = Double(min(max(css, CSSWeight.minimum), CSSWeight.maximum))
        guard let upper = axis.firstIndex(where: { $0.css >= value }) else { return .black }
        if axis[upper].css == value || upper == 0 { return axis[upper].ui }
        let low = axis[upper - 1], high = axis[upper]
        let fraction = (value - low.css) / (high.css - low.css)
        return UIFont.Weight(rawValue: low.ui.rawValue + (high.ui.rawValue - low.ui.rawValue) * fraction)
    }

    /// The UIKit text style whose Dynamic Type curve a token size follows. The pairing is a
    /// platform choice (the extension has no Dynamic Type): each token scales like the system
    /// style closest to it at the default "Large" size, so at "Large" the size is the token itself.
    static func textStyle(for size: CGFloat) -> UIFont.TextStyle {
        switch size {
        case TextStyleBand.largeTitle...:
            .largeTitle

        case TextStyleBand.title1..<TextStyleBand.largeTitle:
            .title1

        case TextStyleBand.title2..<TextStyleBand.title1:
            .title2

        case TextStyleBand.title3..<TextStyleBand.title2:
            .title3

        case TextStyleBand.headline..<TextStyleBand.title3:
            .headline

        case TextStyleBand.body..<TextStyleBand.headline:
            .body

        case TextStyleBand.footnote..<TextStyleBand.body:
            .footnote

        case TextStyleBand.caption1..<TextStyleBand.footnote:
            .caption1

        default:
            .caption2
        }
    }

    /// The token size scaled for a Dynamic Type setting. Equal to `size` at `.large`.
    static func scaled(_ size: CGFloat, for dynamicType: DynamicTypeSize) -> CGFloat {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(dynamicType))
        return UIFontMetrics(forTextStyle: textStyle(for: size)).scaledValue(for: size, compatibleWith: traits)
    }

    static func uiFont(size: CGFloat, weight: Int, mono: Bool) -> UIFont {
        mono
            ? .monospacedSystemFont(ofSize: size, weight: self.weight(weight))
            : .systemFont(ofSize: size, weight: self.weight(weight))
    }
}

/// Renders text on the CSS line box: the extra leading of `line-height` is split above and below
/// each line as CSS half-leading, so a text block is as tall as the same block in the extension.
private struct BrambleTextModifier: ViewModifier {
    @Environment(\.dynamicTypeSize) private var dynamicType
    let style: BrambleTypeStyle
    let weight: Int
    let tracking: CGFloat
    let mono: Bool

    /// CSS half-leading: the extra leading is shared between the space above and below a line.
    private static let leadingShares: CGFloat = 2

    func body(content: Content) -> some View {
        let size = BrambleTypography.scaled(style.size, for: dynamicType)
        let font = BrambleTypography.uiFont(size: size, weight: weight, mono: mono)
        let leading = max(0, size * style.lineHeight - font.lineHeight)
        content
            .font(Font(font))
            .tracking(size * tracking)
            .lineSpacing(leading)
            .padding(.vertical, leading / Self.leadingShares)
    }
}

extension View {
    /// A type-scale style: size (scaled by Dynamic Type), CSS weight, the token's line height, and
    /// tracking in em.
    func brambleText(
        _ style: BrambleTypeStyle,
        weight: Int = BrambleWeight.regular,
        tracking: CGFloat = 0,
        mono: Bool = false
    ) -> some View {
        modifier(BrambleTextModifier(style: style, weight: weight, tracking: tracking, mono: mono))
    }
}

/// A length that follows Dynamic Type with the same curve as the text beside it (row heights and
/// icons next to text). Equal to the metric at "Large".
enum BrambleScaled {
    static func value(_ metric: CGFloat, relativeTo textSize: CGFloat, _ dynamicType: DynamicTypeSize) -> CGFloat {
        metric * BrambleTypography.scaled(textSize, for: dynamicType) / textSize
    }
}
