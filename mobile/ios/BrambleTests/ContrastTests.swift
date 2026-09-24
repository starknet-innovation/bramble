import SwiftUI
import UIKit
import XCTest

/// WCAG contrast over the generated `BrambleSkin`, with the thresholds and pairs of the extension's
/// `ui-kit/tests/theme/skin-contrast.test.ts`, plus the pairs only the phone draws (toast chips,
/// the pressed action tile, an invalid recovery word). Colours are read back from the SwiftUI
/// `Color` values the app renders, so this checks the generated mobile pipeline, not the source.
final class ContrastTests: XCTestCase {
    private typealias RGB = (r: Double, g: Double, b: Double)
    private let aa = 4.5, nonText = 3.0

    private func rgb(_ color: Color, over ground: Color? = nil) -> RGB {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        guard a < 1, let ground else { return (r * 255, g * 255, b * 255) }
        let under = rgb(ground)
        return (r * 255 * a + under.r * (1 - a), g * 255 * a + under.g * (1 - a), b * 255 * a + under.b * (1 - a))
    }

    private func luminance(_ c: RGB) -> Double {
        func channel(_ v: Double) -> Double {
            let s = v / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }

    private func contrast(_ a: RGB, _ b: RGB) -> Double {
        let (x, y) = (luminance(a), luminance(b))
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    private func check(_ ink: Color, on ground: Color, _ minimum: Double, _ what: String, _ skin: BrambleSkin, file: StaticString = #filePath, line: UInt = #line) {
        let ratio = contrast(rgb(ink, over: ground), rgb(ground))
        XCTAssertGreaterThanOrEqual(ratio, minimum, "\(skin.name): \(what) is \(String(format: "%.2f", ratio)):1", file: file, line: line)
    }

    private let skins = [BrambleSkin.midnight, BrambleSkin.daylight]

    func testInksMeetAAOnEverySurfaceTier() {
        for skin in skins {
            let inks = [("text", skin.text), ("muted", skin.muted), ("accent", skin.accent), ("positive", skin.positive), ("danger", skin.danger), ("warning", skin.warning)]
            let grounds = [("bg", skin.bg), ("panel", skin.panel), ("elevated", skin.elevated), ("sunken", skin.sunken)]
            for (inkName, ink) in inks {
                for (groundName, ground) in grounds {
                    check(ink, on: ground, aa, "\(inkName) on \(groundName)", skin)
                }
            }
            for (groundName, ground) in grounds {
                check(skin.border, on: ground, nonText, "field edge on \(groundName)", skin)
            }
        }
    }

    func testFillPairsFromTheExtensionRules() {
        for skin in skins {
            check(skin.accentText, on: skin.accent, aa, "CTA label on accent", skin)
            check(skin.bg, on: skin.danger, aa, "badge ink on danger", skin)
            check(skin.accent, on: skin.accentSoft, aa, "accent on accent-soft", skin)
            check(skin.danger, on: skin.dangerSoft, aa, "danger on danger-soft", skin)
            check(skin.accountAvatarPaper, on: skin.accountAvatar0, nonText, "avatar paper on tone 0", skin)
            check(skin.accountAvatarPaper, on: skin.accountAvatar3, nonText, "avatar paper on tone 3", skin)
            check(skin.accountAvatarInk, on: skin.accountAvatar1, nonText, "avatar ink on tone 1", skin)
            check(skin.accountAvatarInk, on: skin.accountAvatar2, nonText, "avatar ink on tone 2", skin)
        }
    }

    func testPairsOnlyThePhoneDraws() {
        for skin in skins {
            check(skin.accent, on: skin.actionTilePress, aa, "action label on the pressed tile", skin)
            check(skin.danger, on: skin.recoveryWordInvalid.compositedOver(skin.panel), aa, "invalid word ink", skin)
            check(skin.positive, on: skin.positiveSoft, nonText, "success toast glyph on positive-soft", skin)
            check(skin.danger, on: skin.dangerSoft, nonText, "error toast glyph on danger-soft", skin)
        }
    }
}

private extension Color {
    /// This (possibly translucent) colour flattened over an opaque ground.
    func compositedOver(_ ground: Color) -> Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        var gr: CGFloat = 0, gg: CGFloat = 0, gb: CGFloat = 0, ga: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        UIColor(ground).getRed(&gr, green: &gg, blue: &gb, alpha: &ga)
        return Color(.sRGB, red: r * a + gr * (1 - a), green: g * a + gg * (1 - a), blue: b * a + gb * (1 - a))
    }
}
