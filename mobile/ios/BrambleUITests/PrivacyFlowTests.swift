import XCTest

/// Walks the private-balance surfaces on a simulator against the DEBUG fixtures
/// (`-BrambleRpcFixture` for the node, `-BramblePrivacyFixture` for the privacy service), so
/// nothing touches a network: the Home tile, hero label and unified rows, Receive's
/// "Public transfers only" notice, and every journey stop, mirroring the UI Lab stories under
/// "Wallet journeys/04 Private balances". Nothing is ever submitted: the fixture node must
/// report zero writes wherever Send's marker is reachable, and no privacy write path exists.
final class PrivacyFlowTests: XCTestCase {
    private let phrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
    private let passphrase = "ui test passphrase"

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tap(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 15), "\(element) exists")
        element.tap()
    }

    private func type(_ text: String, into field: XCUIElement) {
        XCTAssertTrue(field.waitForExistence(timeout: 10), "\(field) exists")
        field.tap()
        field.typeText(text)
    }

    private func tapScreenButton(_ app: XCUIApplication, _ label: String) {
        let keys = app.keyboards.buttons.allElementsBoundByIndex.map(\.frame)
        let button = app.buttons.matching(identifier: label).allElementsBoundByIndex.first { !keys.contains($0.frame) }
        tap(button ?? app.buttons[label])
    }

    /// Launches against both fixtures, importing the published phrase on a fresh install or
    /// unlocking an existing one.
    private func launch(node: String, privacy: String, network: String = "mainnet") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-network", network, "-BrambleRpcFixture", node, "-BramblePrivacyFixture", privacy]
        app.launch()
        if app.buttons["Add an existing wallet"].waitForExistence(timeout: 8) {
            tap(app.buttons["Add an existing wallet"])
            tap(app.buttons["Recovery phrase"])
            for (index, word) in phrase.split(separator: " ").enumerated() {
                let field = app.textFields["Word \(index + 1)"]
                XCTAssertTrue(field.waitForExistence(timeout: 5))
                if !field.isHittable { app.swipeUp() }
                field.tap()
                field.typeText(String(word))
            }
            tapScreenButton(app, "Continue")
            type(passphrase, into: app.secureTextFields["Vault passphrase"])
            type(passphrase, into: app.secureTextFields["Confirm passphrase"])
            tap(app.buttons["Find your accounts"])
            let mainnetRisk = app.buttons["I understand this wallet can hold real funds on Starknet Mainnet."]
            if mainnetRisk.waitForExistence(timeout: 5) { mainnetRisk.tap() }
            tap(app.buttons["Add selected account"])
            tap(app.buttons["Open Bramble"])
        } else {
            type(passphrase, into: app.secureTextFields["Enter your passphrase"])
            tap(app.buttons["Unlock"])
        }
        XCTAssertTrue(app.staticTexts["Account 1"].waitForExistence(timeout: 20))
        return app
    }

    private func assertUnsupported(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["Not available in the mobile app yet"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Back to wallet"].exists)
        XCTAssertFalse(app.buttons["Deploy and enable"].exists)
    }

    func testRegisteredPortfolioIncludesPrivateValueAndShieldIsUnsupported() {
        let app = launch(node: "transfer-deployed", privacy: "registered")
        XCTAssertTrue(app.staticTexts["Includes shielded balances"].waitForExistence(timeout: 20))
        // 100 public ETH plus 0.5 private, summed as the extension's unified row does.
        XCTAssertTrue(app.staticTexts["100.50"].waitForExistence(timeout: 5))
        tap(app.buttons["Show ETH balance breakdown"])
        XCTAssertTrue(app.staticTexts["0.50 ETH"].waitForExistence(timeout: 5))
        snapshot(app, "privacy-private-portfolio")
        tap(app.buttons["Shield public value into your private balance"])
        assertUnsupported(app)
        snapshot(app, "privacy-unsupported")
    }

    func testUnregisteredOffersRegistrationThatStopsAtUnsupported() {
        let app = launch(node: "transfer-deployed", privacy: "unregistered")
        tap(app.buttons["Show STRK balance breakdown"])
        XCTAssertTrue(app.staticTexts["Register to start shielding"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.staticTexts["Includes shielded balances"].exists)
        snapshot(app, "privacy-public-portfolio")
        tap(app.buttons["Receive"])
        XCTAssertTrue(app.staticTexts["Public transfers only"].waitForExistence(timeout: 10))
        snapshot(app, "privacy-receive-notice")
        tap(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Enable privacy")).firstMatch)
        assertUnsupported(app)
    }

    func testServiceFailureOffersARetry() {
        let app = launch(node: "transfer-deployed", privacy: "service-failed")
        XCTAssertTrue(app.buttons["Private balances, Try again"].waitForExistence(timeout: 20))
        snapshot(app, "privacy-service-failed")
        tap(app.buttons["Activate private balances"])
        XCTAssertTrue(app.staticTexts["Private balances unavailable"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Try again"].exists)
    }

    func testUndeployedAndFundedStopsAtTheDeployBlockerWithoutADeployButton() {
        let app = launch(node: "transfer-undeployed", privacy: "unregistered")
        tap(app.buttons["Deploy and enable"])
        XCTAssertTrue(app.staticTexts["Deploy this account first"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["Deploy and enable"].exists, "deployment is never offered from privacy")
        snapshot(app, "privacy-deploy-blocker")
    }

    func testUndeployedAndUnfundedSendsToReceive() {
        let app = launch(node: "transfer-unfunded", privacy: "unregistered")
        tap(app.buttons["Receive STRK before deploying this account"])
        XCTAssertTrue(app.staticTexts["Your Starknet address"].waitForExistence(timeout: 10))
    }

    func testSepoliaIsNotAvailableOnThisNetwork() {
        let app = launch(node: "transfer-deployed", privacy: "registered", network: "sepolia")
        tap(app.buttons["Activate private balances"])
        XCTAssertTrue(app.staticTexts["Not available on this network"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Choose a network"].exists)
        snapshot(app, "privacy-unconfigured")
    }
}
