import XCTest

/// Drives the real app on a simulator through both first-run paths, against Starknet mainnet,
/// attaching a screenshot at every step for design review against the extension's UI Lab.
///
/// The import path uses the repository's published E2E phrase by default. To exercise a funded
/// wallet, pass one through the environment; it must never be committed:
///
///   TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" \
///   TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_ADDRESS=0x… xcodebuild test …
///
/// XCUITest logs typed text in the result bundle: delete it after running with a real phrase.
final class OnboardingFlowTests: XCTestCase {
    private let publicPhrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
    private let publicAddress = "0x208361e3911b1d93a704400b88e7e53a89171fce64dbb48f8479e4f44b398d9"
    private let passphrase = "ui test passphrase"

    private var phrase: String { ProcessInfo.processInfo.environment["BRAMBLE_MOBILE_MAINNET_MNEMONIC"] ?? publicPhrase }
    private var address: String { ProcessInfo.processInfo.environment["BRAMBLE_MOBILE_MAINNET_ADDRESS"] ?? publicAddress }

    private func short(_ value: String) -> String {
        let canonical = "0x" + value.lowercased().dropFirst(2).drop { $0 == "0" }
        return "\(canonical.prefix(6))…\(canonical.suffix(4))"
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func type(_ text: String, into field: XCUIElement) {
        XCTAssertTrue(field.waitForExistence(timeout: 5), "\(field) exists")
        field.tap()
        field.typeText(text)
    }

    private func tap(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "\(element) exists")
        XCTAssertTrue(element.isEnabled, "\(element) is enabled")
        element.tap()
    }

    private func launchFresh() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-network", "mainnet", "-BrambleUITestReset"]
        app.launch()
        XCTAssertTrue(app.buttons["Create a new wallet"].waitForExistence(timeout: 10),
                      "Uninstall Bramble from the simulator before running the UI suite")
        return app
    }

    private func setPassphrase(_ app: XCUIApplication, cta: String) {
        type(passphrase, into: app.secureTextFields["Vault passphrase"])
        type(passphrase, into: app.secureTextFields["Confirm passphrase"])
        snapshot(app, "passphrase")
        tap(app.buttons[cta])
    }

    private func reviewAndAdd(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["Review your account"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Primary Bramble account"].exists)
        tap(app.buttons["I understand this wallet can hold real funds on Starknet Mainnet."])
        snapshot(app, "review-account")
        tap(app.buttons["Add selected account"])
    }

    /// The header names the account the extension's way (label or nickname), never "Account 1".
    private func checkHeader(_ app: XCUIApplication) {
        let header = app.buttons["Accounts"]
        XCTAssertTrue(header.waitForExistence(timeout: 20))
        let name = header.value as? String ?? ""
        XCTAssertFalse(name.isEmpty || name.hasPrefix("Account"), "header shows \(name)")
    }

    private func finishAndCheckHome(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["You’re all set"].waitForExistence(timeout: 10))
        snapshot(app, "complete")
        tap(app.buttons["Open Bramble"])
        checkHeader(app)
        sleep(4)
        snapshot(app, "home")
    }

    private func canonical(_ value: String) -> String {
        "0x" + value.lowercased().dropFirst(2).drop { $0 == "0" }
    }

    /// "Find your accounts" against Mainnet: the expected account is listed and selected, then
    /// restored behind the acknowledgement.
    private func discoverAndRestore(_ app: XCUIApplication, expecting account: String) {
        XCTAssertTrue(app.staticTexts["Find your accounts"].waitForExistence(timeout: 20))
        let done = app.staticTexts["Search complete. Checked 20 indices across every account type."]
        XCTAssertTrue(done.waitForExistence(timeout: 180), "discovery completes against Mainnet")
        let group = app.buttons["Bramble accounts"]
        if (group.value as? String) != "Expanded" { tap(group) }
        let row = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", short(account))).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the expected account is discovered")
        if !row.isSelected { row.tap() }
        snapshot(app, "find-accounts")
        app.swipeUp()
        tap(app.buttons["I checked these account types and indices and want to restore the selected accounts on Starknet Mainnet."])
        tap(app.buttons["Restore selected accounts"])
    }

    func testCreateBackupAndConfirm() {
        let app = launchFresh()
        snapshot(app, "welcome")
        tap(app.buttons["Create a new wallet"])
        setPassphrase(app, cta: "Continue")
        reviewAndAdd(app)

        XCTAssertTrue(app.staticTexts["Save your recovery phrase"].waitForExistence(timeout: 10))
        snapshot(app, "save-phrase-masked")
        XCTAssertFalse(app.buttons["I saved my phrase"].isEnabled, "continue waits for the reveal")
        tap(app.buttons["Show recovery phrase"])
        snapshot(app, "save-phrase-revealed")
        // Words render in grid order after their position numbers.
        let words = (1...12).map { index -> String in
            let cell = app.staticTexts.matching(identifier: "recovery-word-\(index)").firstMatch
            XCTAssertTrue(cell.waitForExistence(timeout: 5))
            return cell.label
        }
        tap(app.buttons["I saved my phrase"])

        XCTAssertTrue(app.staticTexts["Confirm your backup"].waitForExistence(timeout: 5))
        for (field, position) in zip(["Word 3", "Word 7", "Word 11"], [3, 7, 11]) {
            type(words[position - 1], into: app.textFields[field])
        }
        XCTAssertTrue(app.staticTexts["Backup confirmed."].waitForExistence(timeout: 5))
        snapshot(app, "confirm-backup")
        tap(app.buttons["Continue"])
        finishAndCheckHome(app)

        // Leave the simulator clean for the next test, through the real removal path.
        tap(app.buttons["Settings"])
        app.swipeUp()
        tap(app.buttons["Remove wallet from this device"])
        type(passphrase, into: app.secureTextFields["Confirm vault passphrase"])
        snapshot(app, "remove-wallet")
        tap(app.buttons["Remove wallet"])
        XCTAssertTrue(app.buttons["Create a new wallet"].waitForExistence(timeout: 10), "back to first run")
    }

    func testImportOnMainnetThenLockAndUnlock() {
        let app = launchFresh()
        tap(app.buttons["Add an existing wallet"])
        XCTAssertTrue(app.staticTexts["Choose how to add your wallet"].waitForExistence(timeout: 5))
        snapshot(app, "import-method")
        tap(app.buttons["Recovery phrase"])
        // One word per cell, as a person types them; a space would also advance to the next cell.
        for (index, word) in phrase.split(separator: " ").enumerated() {
            let field = app.textFields["Word \(index + 1)"]
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            if !field.isHittable { app.swipeUp() }
            field.tap()
            field.typeText(String(word))
        }
        snapshot(app, "recovery-phrase")
        tap(app.buttons["Continue"])
        setPassphrase(app, cta: "Find your accounts")
        discoverAndRestore(app, expecting: address)
        finishAndCheckHome(app)

        tap(app.buttons["Receive"])
        XCTAssertTrue(app.buttons["Copy address"].waitForExistence(timeout: 5))
        snapshot(app, "receive")
        tap(app.buttons["Back"])

        tap(app.buttons["Settings"])
        snapshot(app, "settings")
        tap(app.buttons["Network"])
        snapshot(app, "network")
        tap(app.buttons["Back"])
        tap(app.buttons["Appearance"])
        tap(app.buttons["Light"])
        snapshot(app, "appearance-light")
        tap(app.buttons["Dark"])
        tap(app.buttons["Back"])

        tap(app.buttons["Accounts"])
        XCTAssertTrue(app.buttons["Add account"].waitForExistence(timeout: 5))
        let listed = app.buttons.matching(NSPredicate(format: "value == %@", canonical(address)))
        XCTAssertTrue(listed.firstMatch.exists, "the drawer lists the expected mainnet account")
        snapshot(app, "accounts")
        tap(app.buttons["Close accounts"])

        tap(app.buttons["Lock wallet"].firstMatch)
        XCTAssertTrue(app.staticTexts["Welcome back"].waitForExistence(timeout: 5))
        type("wrong passphrase", into: app.secureTextFields["Enter your passphrase"])
        tap(app.buttons["Unlock"])
        XCTAssertTrue(app.staticTexts["Incorrect passphrase"].firstMatch.waitForExistence(timeout: 10))
        snapshot(app, "unlock-failed")
        app.secureTextFields["Enter your passphrase"].tap()
        app.secureTextFields["Enter your passphrase"].typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + passphrase)
        tap(app.buttons["Unlock"])
        checkHeader(app)

        // Leave the simulator clean for the suites that follow (SecurityFlowTests expects a
        // fresh install), through the real removal path.
        tap(app.buttons["Settings"])
        app.swipeUp()
        tap(app.buttons["Remove wallet from this device"])
        type(passphrase, into: app.secureTextFields["Confirm vault passphrase"])
        tap(app.buttons["Remove wallet"])
        XCTAssertTrue(app.buttons["Create a new wallet"].waitForExistence(timeout: 10), "back to first run")
    }
}
