import XCTest

/// Small controls keep their 34/40pt visual frame but answer taps across a 44pt region
/// (design-mobile.md 4.3). SwiftUI reports the expanded content shape as the accessibility frame,
/// so each check asserts that frame is at least 44pt and taps inside the expansion band — the
/// outer 5pt (segment) or 2pt (icon button) that is not part of the visual control — and asserts
/// the control acted.
final class HitTargetTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try UITest.refuseRealPhrase()
    }

    override func tearDownWithError() throws {
        // Restores the XCTest default that setUp changed; nothing else is shared between tests.
        continueAfterFailure = true
        try super.tearDownWithError()
    }

    func testSmallControlsAnswerAcrossTheirExpandedRegion() {
        let app = UITest.launch()
        UITest.resetToFirstRun(app)
        UITest.importPublicWallet(app)

        UITest.tap(app.buttons["Settings"])
        UITest.tap(app.buttons["Appearance"])
        let light = app.buttons["Light"], dark = app.buttons["Dark"]
        UITest.wait(light)
        if light.isSelected { dark.tap() }
        XCTAssertTrue(dark.isSelected)

        // Segment: 34pt visual, 44pt region; 1pt inside the region's top is 4pt above the pill.
        XCTAssertGreaterThanOrEqual(light.frame.height, 44, "segment hit region \(light.frame)")
        UITest.point(app, light.frame.midX, light.frame.minY + 1).tap()
        XCTAssertTrue(light.waitForSelection(), "a tap in the expansion band selects Light")
        dark.tap()

        // Icon button: 40pt visual, 44pt region; 0.5pt inside the region's leading edge.
        let back = app.buttons["Back"]
        XCTAssertGreaterThanOrEqual(back.frame.width, 44, "icon button hit region \(back.frame)")
        UITest.point(app, back.frame.minX + 0.5, back.frame.midY).tap()
        UITest.wait(app.buttons["Network"], 5)

        // Header lock: 0.5pt inside the region's trailing edge still locks.
        UITest.tap(app.buttons["Home"])
        let lock = app.buttons["Lock wallet"].firstMatch
        UITest.wait(lock)
        XCTAssertGreaterThanOrEqual(lock.frame.width, 44, "header lock hit region \(lock.frame)")
        UITest.point(app, lock.frame.maxX - 0.5, lock.frame.midY).tap()
        UITest.wait(app.staticTexts["Welcome back"], 5)

        UITest.unlock(app)
        UITest.removeWallet(app)
    }
}

private extension XCUIElement {
    /// How often `waitForSelection` re-reads the element, in seconds.
    private static let selectionPollInterval: TimeInterval = 0.1

    func waitForSelection(timeout: TimeInterval = 3) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if isSelected { return true }
            Thread.sleep(forTimeInterval: Self.selectionPollInterval)
        }
        return isSelected
    }
}
