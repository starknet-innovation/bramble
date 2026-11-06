import XCTest

/// Walks the private-balance surfaces on a simulator against the DEBUG fixtures
/// (`-uiTestOfflineFixtures <state>` for the node, `-BramblePrivacyFixture <scenario>` for the
/// privacy service), so nothing touches a network: the Home Shield tile, hero label, unified rows
/// and "Private balances · Try again", token detail's private-balance section, Receive's "Public
/// transfers only" notice, and every journey stop (mobile/docs/privacy.md §2), mirroring the UI Lab
/// stories under "Wallet journeys/04 Private balances". Nothing is ever submitted, and no privacy
/// write path exists.
final class PrivacyFlowTests: XCTestCase {
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
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tap(_ element: XCUIElement) {
        UITest.tap(element)
    }

    /// Launches against both fixtures, importing the published phrase on a fresh install or
    /// unlocking the wallet an earlier test left.
    private func launch(node: String, privacy: String, network: String = "mainnet") -> XCUIApplication {
        let app = UITest.launch(fixtures: node, network: network, extra: ["-BramblePrivacyFixture", privacy])
        UITest.openWallet(app)
        return app
    }

    /// Opens a token's detail screen from its unified Home row.
    private func openToken(_ app: XCUIApplication, _ symbol: String) {
        tap(app.descendants(matching: .any)["token-row-\(symbol)"].firstMatch)
        UITest.wait(app.staticTexts["Your balance"])
    }

    private func assertUnsupported(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["Not available in the mobile app yet"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Back to wallet"].exists)
        XCTAssertFalse(app.buttons["Deploy"].exists, "deployment is never offered from privacy")
    }

    func testRegisteredPortfolioIncludesPrivateValueAndShieldIsUnsupported() {
        let app = launch(node: "ready", privacy: "registered")
        XCTAssertTrue(app.staticTexts["Includes shielded balances"].waitForExistence(timeout: 20))
        // 0.042 public ETH plus 0.5 private, summed into one row as the extension's unified row does.
        UITest.wait(UITest.labelled(app, containing: "ETH, 0.54"))
        snapshot(app, "privacy-private-portfolio")
        // Token detail carries the private half and the (disabled) Shield and Unshield actions.
        openToken(app, "ETH")
        UITest.wait(UITest.labelled(app, containing: "Private balance, 0.5 ETH"))
        XCTAssertFalse(app.buttons["Shield"].isEnabled, "shielding is not built on mobile")
        XCTAssertFalse(app.buttons["Unshield"].isEnabled, "unshielding is not built on mobile")
        XCTAssertTrue(app.staticTexts["Not available in the mobile app yet"].exists)
        snapshot(app, "privacy-token-detail")
        tap(app.buttons["Back"].firstMatch)
        tap(app.buttons["Shield public value into your private balance"])
        assertUnsupported(app)
        snapshot(app, "privacy-unsupported")
    }

    func testUnregisteredOffersRegistrationThatStopsAtUnsupported() {
        let app = launch(node: "ready", privacy: "unregistered")
        openToken(app, "STRK")
        UITest.wait(UITest.labelled(app, containing: "Register to start shielding"))
        XCTAssertTrue(app.buttons["Go private"].exists)
        snapshot(app, "privacy-public-token-detail")
        tap(app.buttons["Back"].firstMatch)
        XCTAssertFalse(app.staticTexts["Includes shielded balances"].exists)
        snapshot(app, "privacy-public-portfolio")
        tap(app.buttons["Receive"])
        XCTAssertTrue(app.staticTexts["Public transfers only"].waitForExistence(timeout: 10))
        snapshot(app, "privacy-receive-notice")
        tap(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Enable privacy")).firstMatch)
        assertUnsupported(app)
    }

    func testServiceFailureOffersARetry() {
        let app = launch(node: "ready", privacy: "service-failed")
        XCTAssertTrue(app.buttons["Private balances, Try again"].waitForExistence(timeout: 20))
        snapshot(app, "privacy-service-failed")
        tap(app.buttons["Activate private balances"])
        XCTAssertTrue(app.staticTexts["Private balances unavailable"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Try again"].exists)
    }

    func testUndeployedAndFundedStopsAtTheDeployBlockerWithoutADeployButton() {
        let app = launch(node: "undeployed", privacy: "unregistered")
        // Token detail's "Shield" and the Shield tile both reach the deploy blocker, never a deploy.
        openToken(app, "STRK")
        tap(app.buttons["Shield"])
        XCTAssertTrue(app.staticTexts["Deploy this account first"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Deploy this account before enabling private balances"].exists)
        XCTAssertFalse(app.buttons["Deploy"].exists, "deployment is never offered from privacy")
        tap(app.buttons["Back to wallet"])
        tap(app.buttons["Back"].firstMatch)
        // The tile reads "Shield"; its accessible name says what stands in the way.
        tap(app.buttons["Shield — deploy this account first"])
        XCTAssertTrue(app.staticTexts["Deploy this account first"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["Deploy"].exists, "deployment is never offered from privacy")
        snapshot(app, "privacy-deploy-blocker")
    }

    func testUndeployedAndUnfundedStopsAtTheFundBlocker() {
        let app = launch(node: "unfunded", privacy: "unregistered")
        // The tile opens the journey, which names the prerequisite itself (no detour to Receive).
        tap(app.buttons["Shield — add STRK to this account first"])
        XCTAssertTrue(app.staticTexts["Initialize your account"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Deposit some STRK, then come back"].exists)
    }

    func testSepoliaIsNotAvailableOnThisNetwork() {
        let app = launch(node: "ready", privacy: "registered", network: "sepolia")
        tap(app.buttons["Activate private balances"])
        XCTAssertTrue(app.staticTexts["Not available on this network"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Choose a network"].exists)
        snapshot(app, "privacy-unconfigured")
    }
}
