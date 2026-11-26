import XCTest

/// Settings → Token allowances: the manager opens over the fixture node, reads the account's
/// grants (none: the fixture's chain has no `Approval` events and the wallet granted nothing), and
/// says so with the header's count. Offline: the fixture node only; nothing is ever broadcast. The
/// rows, the revoke review and its submission are covered by `AllowanceFlowTests` against the core.
final class AllowancesTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try UITest.refuseRealPhrase()
    }

    override func tearDownWithError() throws {
        // Restores the XCTest default that setUp changed; nothing else is shared between tests.
        continueAfterFailure = true
        try super.tearDownWithError()
    }

    func testTheManagerListsWhatTheChainAndTheWalletHold() {
        let app = UITest.launch()
        UITest.openWallet(app)
        UITest.tap(app.buttons["Settings"])
        app.swipeUp()
        UITest.tap(app.buttons["Token allowances"])
        UITest.wait(app.staticTexts["Allowances"])
        UITest.wait(app.staticTexts["No allowances on tokens you track."])
        XCTAssertTrue(app.staticTexts["0 outstanding"].exists, "the count is shown once the list is read")
        XCTAssertTrue(app.buttons["Refresh allowances"].isEnabled)
        UITest.tap(app.buttons["What this list includes"])
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'It includes approvals'")).firstMatch.exists
        )
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "allowances-empty-\(UITest.deviceName)"
        attachment.lifetime = .keepAlways
        add(attachment)
        UITest.tap(app.buttons["Back"])
        UITest.wait(app.buttons["Token allowances"])
    }
}
