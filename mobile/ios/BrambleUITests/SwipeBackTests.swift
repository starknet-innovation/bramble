import XCTest

/// The leading-edge back swipe (design-mobile.md 4.6): it returns to the previous step on the
/// pre-vault onboarding steps, does nothing once the vault is written, and pops wallet flows.
final class SwipeBackTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try UITest.refuseRealPhrase()
    }

    override func tearDownWithError() throws {
        // Restores the XCTest default that setUp changed; nothing else is shared between tests.
        continueAfterFailure = true
        try super.tearDownWithError()
    }

    private func assertSwipeReturns(_ app: XCUIApplication, from here: String, to previous: XCUIElement) {
        UITest.wait(app.staticTexts[here])
        UITest.edgeSwipe(app)
        UITest.wait(previous, 5)
        XCTAssertFalse(app.staticTexts[here].exists, "\(here) was popped")
    }

    private func assertSwipeStays(_ app: XCUIApplication, on here: String) {
        UITest.wait(app.staticTexts[here])
        UITest.edgeSwipe(app)
        Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(app.staticTexts[here].exists, "a swipe on \(here) does nothing")
    }

    func testImportStepsSwipeBackAndWalletFlowsPop() {
        let app = UITest.launch()
        UITest.resetToFirstRun(app)
        UITest.tap(app.buttons["Add an existing wallet"])
        assertSwipeReturns(app, from: "Choose how to add your wallet", to: app.buttons["Create a new wallet"])

        UITest.tap(app.buttons["Add an existing wallet"])
        UITest.tap(app.buttons["Recovery phrase"])
        assertSwipeReturns(
            app,
            from: "Enter your recovery phrase",
            to: app.staticTexts["Choose how to add your wallet"]
        )

        UITest.tap(app.buttons["Recovery phrase"])
        UITest.enterPublicPhrase(app)
        UITest.tap(app.buttons["Continue"])
        assertSwipeReturns(app, from: "Create your vault passphrase", to: app.staticTexts["Enter your recovery phrase"])

        // The recovery step remounts empty: the handed-off phrase is gone.
        XCTAssertEqual(app.textFields["Word 1"].value as? String ?? "", "")
        UITest.enterPublicPhrase(app)
        UITest.tap(app.buttons["Continue"])
        UITest.setPassphrase(app)
        UITest.tap(app.buttons["Find your accounts"])
        UITest.wait(app.staticTexts["Search complete. Checked 20 indices across every account type."], 90)
        assertSwipeStays(app, on: "Find your accounts")
        UITest.restorePrimaryAccount(app)
        assertSwipeStays(app, on: "You’re all set")
        UITest.tap(app.buttons["Open Bramble"])
        UITest.waitForWallet(app)

        UITest.tap(app.buttons["Settings"])
        UITest.tap(app.buttons["Network"])
        assertSwipeReturns(app, from: "Choose where the wallet operates", to: app.buttons["Appearance & currency"])
        UITest.removeWallet(app)
    }

    func testCreateStepsAfterTheVaultDoNotSwipeBack() {
        var app = UITest.launch()
        UITest.resetToFirstRun(app)
        UITest.tap(app.buttons["Create a new wallet"])
        assertSwipeReturns(app, from: "Create your vault passphrase", to: app.buttons["Create a new wallet"])

        UITest.tap(app.buttons["Create a new wallet"])
        UITest.setPassphrase(app)
        UITest.tap(app.buttons["Continue"])
        assertSwipeStays(app, on: "Review your account")
        UITest.tap(app.buttons["Add selected account"])
        assertSwipeStays(app, on: "Save your recovery phrase")
        UITest.tap(app.buttons["Show recovery phrase"])
        UITest.tap(app.buttons["I saved my phrase"])
        assertSwipeStays(app, on: "Confirm your backup")

        app.terminate()
        app = UITest.launch()
        UITest.resetToFirstRun(app)
    }
}
