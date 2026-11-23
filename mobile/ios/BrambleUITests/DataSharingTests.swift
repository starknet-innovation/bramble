import XCTest

/// Settings → Network's "Product analytics" and "Reliability diagnostics" rows: each shows its
/// current state, the choice survives a relaunch, and the export opens the share sheet. Offline:
/// the fixture node only. The default (off) is pinned by the unit tests, since an earlier run on
/// the same simulator may have left a choice behind.
final class DataSharingTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try UITest.refuseRealPhrase()
    }

    override func tearDownWithError() throws {
        // Restores the XCTest default that setUp changed; nothing else is shared between tests.
        continueAfterFailure = true
        try super.tearDownWithError()
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        Thread.sleep(forTimeInterval: 0.8)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(name)-\(UITest.deviceName)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func openNetwork(_ app: XCUIApplication) {
        UITest.openWallet(app)
        UITest.tap(app.buttons["Settings"])
        UITest.tap(app.buttons["Network"])
        app.swipeUp()
    }

    private static let analyticsRow = "Share pseudonymous gateway usage"
    private static let diagnosticsRow = "Keep anonymous RPC and explorer reliability counters on this device"

    /// Opens the disclosure named `title` and returns its checkbox row.
    private func expand(_ app: XCUIApplication, _ title: String, _ row: String) -> XCUIElement {
        UITest.tap(app.buttons[title])
        let check = app.buttons[row]
        UITest.wait(check)
        return check
    }

    /// Ticks or clears `check`, then waits until it reads `wanted`.
    private func set(_ check: XCUIElement, _ wanted: Bool) {
        if check.isSelected != wanted { UITest.tap(check) }
        let settled = NSPredicate(format: wanted ? "isSelected == true" : "isSelected == false")
        wait(for: [expectation(for: settled, evaluatedWith: check)], timeout: 5)
    }

    func testChoicesShowTheirStateAndSurviveARelaunch() {
        var app = UITest.launch()
        openNetwork(app)
        var analytics = expand(app, "Product analytics", Self.analyticsRow)
        set(analytics, true)
        snapshot(app, "product-analytics-on")
        UITest.tap(app.buttons["Product analytics"])
        var diagnostics = expand(app, "Reliability diagnostics", Self.diagnosticsRow)
        set(diagnostics, true)
        snapshot(app, "reliability-diagnostics-on")

        app.terminate()
        app = UITest.launch()
        openNetwork(app)
        analytics = expand(app, "Product analytics", Self.analyticsRow)
        XCTAssertTrue(analytics.isSelected, "the analytics choice survived a relaunch")
        UITest.tap(app.buttons["Product analytics"])
        diagnostics = expand(app, "Reliability diagnostics", Self.diagnosticsRow)
        XCTAssertTrue(diagnostics.isSelected, "the diagnostics choice survived a relaunch")

        UITest.tap(app.buttons["Export diagnostics"])
        UITest.wait(app.otherElements["ActivityListView"], 10)
        snapshot(app, "diagnostics-share")
        let sheet = app.otherElements["ActivityListView"]
        if app.buttons["Close"].exists { app.buttons["Close"].tap() } else { app.swipeDown(velocity: .fast) }
        wait(for: [expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: sheet)], timeout: 10)

        set(diagnostics, false)
        UITest.tap(app.buttons["Reliability diagnostics"])
        analytics = expand(app, "Product analytics", Self.analyticsRow)
        set(analytics, false)
        snapshot(app, "data-sharing-off")
    }
}
