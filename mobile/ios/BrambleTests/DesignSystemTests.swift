import SwiftUI
import XCTest

/// Pure rules behind the phone adaptations: Dynamic Type scaling, CSS weights, the device-class
/// breakpoints, the hit-region expansion, the edge back-swipe, and token-mark tones.
final class DesignSystemTests: XCTestCase {
    func testTypeEqualsTheTokenAtLargeAndGrowsMonotonically() {
        let sizes: [DynamicTypeSize] = [.xSmall, .small, .medium, .large, .xLarge, .xxLarge, .xxxLarge, .accessibility1, .accessibility3, .accessibility5]
        for token in [BrambleTypeScale.caption, BrambleTypeScale.label, BrambleTypeScale.body, BrambleTypeScale.title, BrambleTypeScale.display, BrambleTypeScale.headline, BrambleTypeScale.portfolio] {
            XCTAssertEqual(BrambleTypography.scaled(token.size, for: .large), token.size, accuracy: 0.01, "\(token.size) at Large")
            let scaled = sizes.map { BrambleTypography.scaled(token.size, for: $0) }
            XCTAssertEqual(scaled, scaled.sorted(), "\(token.size) grows with the setting")
        }
    }

    func testCssWeightsIncluding650() {
        XCTAssertEqual(BrambleTypography.weight(600), .semibold)
        XCTAssertEqual(BrambleTypography.weight(700), .bold)
        let w650 = BrambleTypography.weight(650).rawValue
        XCTAssertGreaterThan(w650, UIFont.Weight.semibold.rawValue)
        XCTAssertLessThan(w650, UIFont.Weight.bold.rawValue)
    }

    func testDeviceClassUsesTheFullSceneLikeTheUILabViewport() {
        // (scene size inside the safe area, insets) for SE, 16 and 16 Pro Max in portrait.
        let se = DeviceClass.resolve(size: CGSize(width: 375, height: 647), insets: EdgeInsets(top: 20, leading: 0, bottom: 0, trailing: 0))
        let sixteen = DeviceClass.resolve(size: CGSize(width: 390, height: 751), insets: EdgeInsets(top: 59, leading: 0, bottom: 34, trailing: 0))
        let max = DeviceClass.resolve(size: CGSize(width: 440, height: 863), insets: EdgeInsets(top: 59, leading: 0, bottom: 34, trailing: 0))
        XCTAssertEqual(se, DeviceClass(phone: true, short: true))
        XCTAssertEqual(sixteen, DeviceClass(phone: true, short: false), "844pt scene takes the base height rules")
        XCTAssertEqual(max, DeviceClass(phone: true, short: false))
    }

    func testHitExpansionReachesFortyFourWithoutOverlap() {
        XCTAssertEqual(BrambleHit.expansion(for: BrambleMetrics.IconButton.size), 2)
        XCTAssertEqual(BrambleHit.expansion(for: BrambleMetrics.Segmented.optionHeight), 5)
        XCTAssertEqual(BrambleHit.expansion(for: 48), 0)
        XCTAssertEqual(BrambleHit.expansion(for: 40, gap: 2), 1, "never more than half the gap")
        XCTAssertEqual(BrambleHit.expansion(for: nil), 0)
    }

    func testEdgeSwipeRecognition() {
        let edge = CGPoint(x: 4, y: 400)
        XCTAssertTrue(EdgeSwipe.isBack(start: edge, translation: CGSize(width: 120, height: 10), predicted: CGSize(width: 130, height: 10)))
        XCTAssertTrue(EdgeSwipe.isBack(start: edge, translation: CGSize(width: 40, height: 0), predicted: CGSize(width: 200, height: 0)), "a flick")
        XCTAssertFalse(EdgeSwipe.isBack(start: CGPoint(x: 60, y: 400), translation: CGSize(width: 200, height: 0), predicted: CGSize(width: 200, height: 0)), "not from the edge")
        XCTAssertFalse(EdgeSwipe.isBack(start: edge, translation: CGSize(width: 100, height: 300), predicted: CGSize(width: 100, height: 400)), "a scroll")
        XCTAssertFalse(EdgeSwipe.isBack(start: edge, translation: CGSize(width: 30, height: 0), predicted: CGSize(width: 60, height: 0)), "too short")
    }

    func testTokenMarkToneIsAddressModFour() {
        XCTAssertEqual(TokenMark.tone(of: "0x7"), 3)
        XCTAssertEqual(TokenMark.tone(of: "0x10"), 0)
        XCTAssertEqual(TokenMark.tone(of: "0xabcdef"), 3)
        XCTAssertEqual(TokenMark.tone(of: "not an address"), 0)
    }

    func testElevationTiersFollowTheStylesheet() {
        XCTAssertNil(BrambleElevation.onboardingWizardPhone, "full-bleed wizard casts no shadow at phone width")
        XCTAssertEqual(BrambleElevation.dock, BrambleShadow.md)
        XCTAssertEqual(BrambleElevation.toast, BrambleShadow.lg)
        XCTAssertEqual(BrambleElevation.segmentSelected, BrambleShadow.xs)
        XCTAssertEqual(BrambleElevation.qrCard, BrambleShadow.md)
        XCTAssertEqual(BrambleElevation.onboardingAccountSelected, BrambleShadow.sm)
    }
}
