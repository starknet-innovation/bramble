@testable import Bramble
import SwiftUI
import UIKit
import XCTest

/// WCAG contrast over the generated `BrambleSkin`, with the thresholds and pairs of the extension's
/// `ui-kit/tests/theme/skin-contrast.test.ts`, plus the pairs only the phone draws (toast chips,
/// the pressed action tile, an invalid recovery word). Colours are read back from the SwiftUI
/// `Color` values the app renders, so this checks the generated mobile pipeline, not the source.
final class ContrastTests: XCTestCase {
    private struct RGB {
        let red: Double
        let green: Double
        let blue: Double
    }

    private let textMinimum = 4.5
    private let nonText = 3.0

    private func rgb(_ color: Color, over ground: Color? = nil) -> RGB {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        guard alpha < 1, let ground else { return RGB(red: red * 255, green: green * 255, blue: blue * 255) }
        let under = rgb(ground)
        return RGB(
            red: red * 255 * alpha + under.red * (1 - alpha),
            green: green * 255 * alpha + under.green * (1 - alpha),
            blue: blue * 255 * alpha + under.blue * (1 - alpha)
        )
    }

    private func luminance(_ color: RGB) -> Double {
        func channel(_ value: Double) -> Double {
            let scaled = value / 255
            return scaled <= 0.03928 ? scaled / 12.92 : pow((scaled + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
    }

    private func contrast(_ first: RGB, _ second: RGB) -> Double {
        let (firstLuminance, secondLuminance) = (luminance(first), luminance(second))
        return (max(firstLuminance, secondLuminance) + 0.05) / (min(firstLuminance, secondLuminance) + 0.05)
    }

    private func check(
        _ ink: Color,
        on ground: Color,
        _ minimum: Double,
        _ what: String,
        _ skin: BrambleSkin,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let ratio = contrast(rgb(ink, over: ground), rgb(ground))
        XCTAssertGreaterThanOrEqual(
            ratio,
            minimum,
            "\(skin.name): \(what) is \(String(format: "%.2f", ratio)):1",
            file: file,
            line: line
        )
    }

    private let skins = [BrambleSkin.midnight, BrambleSkin.daylight]

    func testInksMeetAAOnEverySurfaceTier() {
        for skin in skins {
            let inks = [
                ("text", skin.text),
                ("muted", skin.muted),
                ("accent", skin.accent),
                ("positive", skin.positive),
                ("danger", skin.danger),
                ("warning", skin.warning)
            ]
            let grounds = [("bg", skin.bg), ("panel", skin.panel), ("elevated", skin.elevated), ("sunken", skin.sunken)]
            for (inkName, ink) in inks {
                for (groundName, ground) in grounds {
                    check(ink, on: ground, textMinimum, "\(inkName) on \(groundName)", skin)
                }
            }
            for (groundName, ground) in grounds {
                check(skin.border, on: ground, nonText, "field edge on \(groundName)", skin)
            }
        }
    }

    func testFillPairsFromTheExtensionRules() {
        for skin in skins {
            check(skin.accentText, on: skin.accent, textMinimum, "CTA label on accent", skin)
            check(skin.bg, on: skin.danger, textMinimum, "badge ink on danger", skin)
            check(skin.accent, on: skin.accentSoft, textMinimum, "accent on accent-soft", skin)
            check(skin.danger, on: skin.dangerSoft, textMinimum, "danger on danger-soft", skin)
        }
    }

    /// Any ground, body and accent can meet in one bird (`skin-contrast.test.ts`): the body against
    /// its ground, the wing, crest, tail and beak against the body, and the paper eye on the body.
    func testEveryAccountBirdPairing() {
        for skin in skins {
            for (bodyIndex, body) in skin.avatarBodies.enumerated() {
                for (groundIndex, ground) in skin.avatarGrounds.enumerated() {
                    check(body, on: ground, nonText, "bird body \(bodyIndex) on ground \(groundIndex)", skin)
                }
                for (accentIndex, accent) in skin.avatarAccents.enumerated() {
                    check(accent, on: body, nonText, "bird accent \(accentIndex) on body \(bodyIndex)", skin)
                }
                check(skin.accountAvatarPaper, on: body, nonText, "bird eye on body \(bodyIndex)", skin)
            }
        }
    }

    func testPairsOnlyThePhoneDraws() {
        for skin in skins {
            check(skin.accent, on: skin.actionTilePress, textMinimum, "action label on the pressed tile", skin)
            check(skin.positive, on: skin.positiveSoft, nonText, "success toast glyph on positive-soft", skin)
            check(skin.danger, on: skin.dangerSoft, nonText, "error toast glyph on danger-soft", skin)
        }
    }
}
