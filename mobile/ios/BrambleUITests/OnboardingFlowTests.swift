import XCTest

/// Drives the real app on a simulator against Starknet mainnet: import, home with live balances,
/// receive, explorer hand-off, background lock, unlock. Screenshots are attached to the result
/// bundle for design review.
///
/// By default it imports the repository's published E2E phrase. To exercise a funded wallet,
/// pass one through the environment; it must never be committed:
///
///   TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" \
///   TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_ADDRESS=0x… xcodebuild test …
final class OnboardingFlowTests: XCTestCase {
    /// Published E2E phrase (tests/e2e/wallet-helpers.ts) and its account 0
    /// (mobile/core/tests/fixtures/extension-parity.json).
    private let publicPhrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
    private let publicAddress = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"
    private let password = "ui test password"

    private var phrase: String { ProcessInfo.processInfo.environment["BRAMBLE_MOBILE_MAINNET_MNEMONIC"] ?? publicPhrase }
    private var address: String { ProcessInfo.processInfo.environment["BRAMBLE_MOBILE_MAINNET_ADDRESS"] ?? publicAddress }

    private func shortAddress(_ value: String) -> String {
        // Canonical felt spelling, as the core renders it.
        let digits = value.lowercased().dropFirst(2).drop { $0 == "0" }
        let canonical = "0x" + digits
        return "\(canonical.prefix(6))…\(canonical.suffix(4))"
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func type(_ text: String, into field: XCUIElement) {
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(text)
    }

    func testMainnetImportExplorerLockAndUnlock() {
        let app = XCUIApplication()
        app.launchArguments = ["-network", "mainnet"]
        app.launch()
        snapshot(app, "01-welcome")

        if app.buttons["Unlock"].exists {
            XCTFail("Uninstall Bramble from the simulator before running the UI suite")
            return
        }
        app.buttons["I already have a recovery phrase"].tap()
        type(phrase, into: app.textViews["Recovery phrase"])
        type(password, into: app.secureTextFields["Password"])
        type(password, into: app.secureTextFields["Confirm password"])
        app.buttons["Import wallet"].tap()

        XCTAssertTrue(app.staticTexts["Account 1"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Mainnet"].exists)
        XCTAssertTrue(app.staticTexts[shortAddress(address)].exists, "home shows the expected mainnet account")
        // Live mainnet read through the core's sans-IO RPC: the STRK row resolves to a number.
        let strk = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "^[0-9][0-9.]*$")).firstMatch
        XCTAssertTrue(strk.waitForExistence(timeout: 20), "a mainnet balance loaded")
        snapshot(app, "02-home-mainnet")

        app.buttons["Receive"].tap()
        XCTAssertTrue(app.buttons["Copy address"].waitForExistence(timeout: 5))
        snapshot(app, "03-receive")
        app.swipeDown(velocity: .fast)

        // Explorer opens the account on the bundled mainnet explorer in Safari.
        XCTAssertTrue(app.buttons["Explorer"].waitForExistence(timeout: 5))
        app.buttons["Explorer"].tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 15), "explorer opened in Safari")
        sleep(3)
        snapshot(safari, "04-explorer")

        // Leaving the app ended the session.
        app.activate()
        XCTAssertTrue(app.buttons["Unlock"].waitForExistence(timeout: 5))
        type(password, into: app.secureTextFields["Password"])
        app.buttons["Unlock"].tap()
        XCTAssertTrue(app.staticTexts["Account 1"].waitForExistence(timeout: 20))
    }
}
