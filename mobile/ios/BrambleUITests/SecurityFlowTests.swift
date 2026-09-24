import Darwin
import notify
import XCTest

/// Vault security on a simulator ("Bramble Workflow" only; see README): biometric unlock with the
/// simulator's Face ID, a non-match that keeps the slot, an enrolment change that drops it,
/// reveal still asking for the passphrase, clipboard clearing after a paste, the dark default,
/// and a backoff that survives relaunching the app. Uses the published test phrase; no funds.
///
/// Face ID is driven through the simulator's BiometricKit notifications, posted from the test
/// runner (it shares the simulator's notification centre). Sign the build ad hoc
/// (`CODE_SIGN_IDENTITY=-`): an unsigned app cannot use the data-protection Keychain.
final class SecurityFlowTests: XCTestCase {
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUpWithError() throws {
        continueAfterFailure = false
        try UITest.refuseRealPhrase()
    }

    // MARK: Simulator biometrics

    private func setFaceIDEnrolled(_ enrolled: Bool) {
        var token: Int32 = 0
        notify_register_check("com.apple.BiometricKit.enrollmentChanged", &token)
        notify_set_state(token, enrolled ? 1 : 0)
        notify_post("com.apple.BiometricKit.enrollmentChanged")
        notify_cancel(token)
        sleep(1)
    }

    private func face(matching: Bool) {
        sleep(2)
        notify_post(matching ? "com.apple.BiometricKit_Sim.pearl.match" : "com.apple.BiometricKit_Sim.pearl.nomatch")
    }

    // MARK: Helpers

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Brings the app back to first run. A wallet left behind by another UI suite (they all use
    /// the same test passphrase) is unlocked and removed through the real removal path, so this
    /// suite passes whether it runs alone or after OnboardingFlowTests.
    private func launchAtFirstRun() -> XCUIApplication {
        let app = UITest.launch()
        let fresh = app.buttons["Create a new wallet"]
        let locked = app.secureTextFields["Enter your passphrase"]
        let deadline = Date().addingTimeInterval(15)
        while !fresh.exists && !locked.exists && Date() < deadline { usleep(250_000) }
        if fresh.exists { return app }
        XCTAssertTrue(locked.exists, "Bramble opened on neither first run nor unlock")
        // A leftover wallet may have Face ID on: dismiss its automatic prompt if one appears.
        let cancel = springboard.buttons["Cancel"]
        if cancel.waitForExistence(timeout: 3) { cancel.tap() }
        let unlock = app.buttons["Unlock"]
        UITest.type(UITest.passphrase, into: locked)
        waitUntilEnabled(unlock, timeout: 90)
        unlock.tap()
        XCTAssertTrue(app.buttons["Accounts"].waitForExistence(timeout: 20),
                      "a leftover wallet uses a passphrase other than the suite's; uninstall Bramble from Bramble Workflow")
        UITest.removeWallet(app)
        return app
    }

    /// Imports the published phrase by pasting it into the first word field.
    private func onboardByPaste() -> XCUIApplication {
        let app = launchAtFirstRun()
        XCTAssertTrue(app.buttons["Create a new wallet"].waitForExistence(timeout: 10), "first run")
        UITest.tap(app.buttons["Add an existing wallet"])
        UITest.tap(app.buttons["Recovery phrase"])
        UIPasteboard.general.string = UITest.publicPhrase
        let first = app.textFields["Word 1"]
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        first.tap()
        first.press(forDuration: 1.2)
        UITest.tap(app.menuItems["Paste"].firstMatch)
        XCTAssertTrue(app.staticTexts["Clipboard cleared"].waitForExistence(timeout: 5))
        XCTAssertFalse(UIPasteboard.general.hasStrings, "the pasted phrase no longer sits on the clipboard")
        snapshot(app, "import-pasted")
        UITest.tap(app.buttons["Continue"])
        UITest.type(UITest.passphrase, into: app.secureTextFields["Vault passphrase"])
        UITest.type(UITest.passphrase, into: app.secureTextFields["Confirm passphrase"])
        UITest.tap(app.buttons["Find your accounts"])
        UITest.restorePrimaryAccount(app)
        UITest.tap(app.buttons["Open Bramble"])
        UITest.waitForWallet(app)
        return app
    }

    private func openSecurity(_ app: XCUIApplication) {
        UITest.tap(app.buttons["Settings"])
        UITest.tap(app.buttons["Unlock & auto-lock"])
    }

    private func waitUntilEnabled(_ element: XCUIElement, timeout: TimeInterval = 20) {
        let enabled = expectation(for: NSPredicate(format: "exists == true AND isEnabled == true"), evaluatedWith: element)
        wait(for: [enabled], timeout: timeout)
    }

    // MARK: Tests

    func testBiometricUnlockLifecycle() {
        setFaceIDEnrolled(true)
        let app = onboardByPaste()

        // Dark is the default on a fresh install.
        UITest.tap(app.buttons["Settings"])
        UITest.tap(app.buttons["Appearance"])
        XCTAssertTrue(app.buttons["Dark"].isSelected)
        UITest.tap(app.buttons["Back"])

        // Turn Face ID on: the passphrase is re-checked first.
        UITest.tap(app.buttons["Unlock & auto-lock"])
        XCTAssertTrue(app.staticTexts["After 30 minutes idle"].exists)
        UITest.tap(app.buttons["On"])
        UITest.type(UITest.passphrase, into: app.secureTextFields["Confirm vault passphrase"])
        UITest.tap(app.buttons["Turn on Face ID"])
        // First use asks for the Face ID permission, then the face itself.
        let allow = springboard.alerts.buttons["Allow"].exists ? springboard.alerts.buttons["Allow"] : app.alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 5) { allow.tap() } else if springboard.buttons["Allow"].exists { springboard.buttons["Allow"].tap() }
        face(matching: true)
        XCTAssertTrue(app.staticTexts["Face ID will unlock this wallet. Your passphrase still works and is still needed to reveal secrets."]
            .waitForExistence(timeout: 20))
        snapshot(app, "security-on")
        UITest.tap(app.buttons["Back"])

        // 1. A matching face unlocks.
        UITest.tap(app.buttons["Lock wallet"].firstMatch)
        XCTAssertTrue(app.staticTexts["Welcome back"].waitForExistence(timeout: 5))
        face(matching: true)
        XCTAssertTrue(app.buttons["Accounts"].waitForExistence(timeout: 20), "Face ID opened the wallet")

        // 2. A non-matching face leaves the passphrase usable and keeps the slot.
        UITest.tap(app.buttons["Lock wallet"].firstMatch)
        XCTAssertTrue(app.staticTexts["Welcome back"].waitForExistence(timeout: 5))
        face(matching: false)
        let cancel = springboard.buttons["Cancel"]
        if cancel.waitForExistence(timeout: 5) { cancel.tap() }
        XCTAssertTrue(app.buttons["Unlock with Face ID"].waitForExistence(timeout: 5), "the slot is kept")
        snapshot(app, "unlock-after-no-match")
        UITest.unlock(app)
        UITest.tap(app.buttons["Settings"])
        XCTAssertEqual(app.buttons["Unlock & auto-lock"].value as? String, "Face ID on")

        // 5. Reveal still needs the passphrase and offers no copy.
        UITest.tap(app.buttons["Reveal recovery secrets"])
        XCTAssertTrue(app.secureTextFields["Confirm vault passphrase"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Copy recovery phrase"].exists)
        UITest.type(UITest.passphrase, into: app.secureTextFields["Confirm vault passphrase"])
        UITest.tap(app.buttons["Reveal secrets"])
        XCTAssertTrue(app.staticTexts.matching(identifier: "recovery-word-1").firstMatch.waitForExistence(timeout: 20))
        snapshot(app, "reveal-shielded")
        UITest.tap(app.buttons["Hide secrets"])
        UITest.tap(app.buttons["Back"])

        // 4. Removing every face while away invalidates the slot and locks.
        XCUIDevice.shared.press(.home)
        setFaceIDEnrolled(false)
        app.activate()
        XCTAssertTrue(app.staticTexts["Face ID changed on this device. Enter your passphrase, then turn it on again in Security."]
            .waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Unlock with Face ID"].exists)
        snapshot(app, "biometric-invalidated")
        setFaceIDEnrolled(true)
        UITest.unlock(app)
        UITest.tap(app.buttons["Settings"])
        XCTAssertEqual(app.buttons["Unlock & auto-lock"].value as? String, "Passphrase only")
        UITest.tap(app.buttons["Home"])
        UITest.removeWallet(app)
    }

    func testBackoffSurvivesRelaunch() {
        let app = onboardByPaste()
        UITest.tap(app.buttons["Lock wallet"].firstMatch)
        XCTAssertTrue(app.staticTexts["Welcome back"].waitForExistence(timeout: 5))
        UITest.type("wrong passphrase", into: app.secureTextFields["Enter your passphrase"])
        let unlock = app.buttons["Unlock"]
        for _ in 1...5 {
            waitUntilEnabled(unlock)
            unlock.tap()
            // The status line, or on the attempt that starts the delay the error toast
            // ("Error: Incorrect passphrase") while the status line counts down.
            XCTAssertTrue(UITest.labelled(app, containing: "Incorrect passphrase").waitForExistence(timeout: 10))
        }
        let throttled = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Too many attempts. Try again in 0:'")).firstMatch
        XCTAssertTrue(throttled.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Unlock"].isEnabled)
        snapshot(app, "throttled")

        app.terminate()
        let relaunched = UITest.launch()
        let countdown = relaunched.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Too many attempts. Try again in 0:'")).firstMatch
        XCTAssertTrue(countdown.waitForExistence(timeout: 10), "the delay survived the relaunch")
        snapshot(relaunched, "throttled-after-relaunch")

        // Wait out the delay, then unlock and leave the simulator clean.
        let ready = relaunched.buttons["Unlock"]
        UITest.type(UITest.passphrase, into: relaunched.secureTextFields["Enter your passphrase"])
        waitUntilEnabled(ready, timeout: 40)
        ready.tap()
        UITest.waitForWallet(relaunched)
        UITest.removeWallet(relaunched)
    }
}
