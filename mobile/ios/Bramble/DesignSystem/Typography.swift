import SwiftUI
import UIKit

// Type rendering for the generated TYPE tokens and stylesheet sizes: CSS weights (including 650,
// which SwiftUI's named weights cannot express), the CSS line box, and Dynamic Type.

enum BrambleTypography {
    /// UIKit's weight axis at each CSS hundred. Values between hundreds (the extension's 650) are
    /// interpolated linearly, so 650 renders between semibold and bold rather than as either.
    private static let axis: [(css: Double, ui: UIFont.Weight)] = [
        (100, .ultraLight), (200, .thin), (300, .light), (400, .regular), (500, .medium),
        (600, .semibold), (700, .bold), (800, .heavy), (900, .black),
    ]

    static func weight(_ css: Int) -> UIFont.Weight {
        let value = Double(min(max(css, 100), 900))
        guard let upper = axis.firstIndex(where: { $0.css >= value }) else { return .black }
        if axis[upper].css == value || upper == 0 { return axis[upper].ui }
        let low = axis[upper - 1], high = axis[upper]
        let t = (value - low.css) / (high.css - low.css)
        return UIFont.Weight(rawValue: low.ui.rawValue + (high.ui.rawValue - low.ui.rawValue) * t)
    }

    /// The UIKit text style whose Dynamic Type curve a token size follows. The pairing is a
    /// platform choice (the extension has no Dynamic Type): each token scales like the system
    /// style closest to it at the default "Large" size, so at "Large" the size is the token itself.
    static func textStyle(for size: CGFloat) -> UIFont.TextStyle {
        switch size {
        case 34...: .largeTitle
        case 26..<34: .title1
        case 21..<26: .title2
        case 18..<21: .title3
        case 16..<18: .headline
        case 14..<16: .body
        case 13..<14: .footnote
        case 12..<13: .caption1
        default: .caption2
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

    func body(content: Content) -> some View {
        let size = BrambleTypography.scaled(style.size, for: dynamicType)
        let font = BrambleTypography.uiFont(size: size, weight: weight, mono: mono)
        let leading = max(0, size * style.lineHeight - font.lineHeight)
        content
            .font(Font(font))
            .tracking(size * tracking)
            .lineSpacing(leading)
            .padding(.vertical, leading / 2)
    }
}

extension View {
    /// A type-scale style: size (scaled by Dynamic Type), CSS weight, the token's line height, and
    /// tracking in em.
    func brambleText(_ style: BrambleTypeStyle, weight: Int = BrambleWeight.regular, tracking: CGFloat = 0, mono: Bool = false) -> some View {
        modifier(BrambleTextModifier(style: style, weight: weight, tracking: tracking, mono: mono))
    }
}

/// A length that follows Dynamic Type with the same curve as the text beside it (row heights and
/// icons next to text). Equal to the metric at "Large".
struct BrambleScaled {
    static func value(_ metric: CGFloat, relativeTo textSize: CGFloat, _ dynamicType: DynamicTypeSize) -> CGFloat {
        metric * BrambleTypography.scaled(textSize, for: dynamicType) / textSize
    }
}
