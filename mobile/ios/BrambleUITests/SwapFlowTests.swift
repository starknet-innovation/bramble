import XCTest

/// Opens Swap from Home on the offline fixture transport (`-uiTestOfflineFixtures`): the pair
/// opens on ETH → STRK, and with no AVNU to answer (the fixture fails every non-RPC request) the
/// quote fails closed in the extension's words for the core's refusal and Review swap stays
/// disabled. Nothing is built,
/// signed or sent.
final class SwapFlowTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try UITest.refuseRealPhrase()
    }

    override func tearDownWithError() throws {
        // Restores the XCTest default that setUp changed; nothing else is shared between tests.
        continueAfterFailure = true
        try super.tearDownWithError()
    }

    func testAnUnansweredQuoteKeepsReviewClosed() {
        let app = UITest.launch(fixtures: "ready")
        UITest.openWallet(app)
        UITest.tap(app.buttons["Swap"].firstMatch)
        let amount = app.textFields["Amount to sell"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Choose sell token"].exists)
        UITest.type("0.01", into: amount)
        let refusal = "Couldn't fetch a quote. Check your connection and try again."
        XCTAssertTrue(app.staticTexts[refusal].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Review swap"].isEnabled)
    }
}
