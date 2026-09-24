import XCTest

/// Captures every mobile screen in both themes for review against the extension's UI Lab stories
/// (design-mobile.md section 3). Offline: Sepolia plus the Debug-only RPC fixtures, so the Home
/// states (ready, empty, balance error) are deterministic and no live host is contacted. Phrase
/// screens are captured masked only. Attachments are named `<screen>-<theme>-<device>`; export
/// them with `mobile/scripts/mobile-parity-shots.sh`.
final class SnapshotTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try UITest.refuseRealPhrase()
    }

    func testImportPathDark() { importPath(theme: "dark") }
    func testImportPathLight() { importPath(theme: "light") }
    func testCreatePathDark() { createPath(theme: "dark") }
    func testCreatePathLight() { createPath(theme: "light") }

    private func shot(_ app: XCUIApplication, _ screen: String, _ theme: String) {
        // Let springs and fades settle so the capture is the resting layout.
        Thread.sleep(forTimeInterval: 0.8)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(screen)-\(theme)-\(UITest.deviceName)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func importPath(theme: String) {
        var app = UITest.launch(theme: theme)
        UITest.resetToFirstRun(app)
        shot(app, "welcome", theme)
        UITest.tap(app.buttons["Add an existing wallet"])
        UITest.wait(app.staticTexts["Choose how to add your wallet"])
        shot(app, "import-method", theme)
        UITest.tap(app.buttons["Recovery phrase"])
        shot(app, "recovery-phrase-empty", theme)
        UITest.enterPublicPhrase(app)
        shot(app, "recovery-phrase", theme)
        UITest.tap(app.buttons["Continue"])
        UITest.wait(app.staticTexts["Create your vault passphrase"])
        shot(app, "passphrase-empty", theme)
        UITest.setPassphrase(app)
        shot(app, "passphrase", theme)
        UITest.tap(app.buttons["Find your accounts"])
        UITest.restorePrimaryAccount(app) { self.shot(app, "find-accounts", theme) }
        shot(app, "complete", theme)
        UITest.tap(app.buttons["Open Bramble"])
        UITest.wait(UITest.labelled(app, containing: "STRK, 125.5"))
        shot(app, "home-ready", theme)

        UITest.tap(app.buttons["Accounts"])
        UITest.wait(app.buttons["Add account"])
        shot(app, "accounts-sheet", theme)
        UITest.tap(app.buttons["Add account"])
        UITest.wait(app.staticTexts["Add a new account"])
        shot(app, "add-account", theme)
        UITest.tap(app.buttons["Close Add account"])
        UITest.tap(app.buttons["Close accounts"])

        UITest.tap(app.buttons["Send"])
        UITest.wait(app.staticTexts["Send to"])
        shot(app, "send-recipient", theme)
        UITest.tap(app.buttons["Back"])

        UITest.tap(app.buttons["Receive"])
        UITest.wait(app.buttons["Copy address"])
        shot(app, "receive", theme)
        UITest.tap(app.buttons["Back"])

        UITest.tap(app.buttons["Activity"])
        shot(app, "activity", theme)
        UITest.tap(app.buttons["Settings"])
        shot(app, "settings", theme)
        UITest.tap(app.buttons["Network"])
        shot(app, "network", theme)
        UITest.tap(app.buttons["Back"])
        UITest.tap(app.buttons["Appearance"])
        shot(app, "appearance", theme)
        UITest.tap(app.buttons["Back"])
        UITest.tap(app.buttons["Reveal recovery secrets"])
        UITest.wait(app.secureTextFields["Confirm vault passphrase"])
        shot(app, "reveal", theme)
        UITest.tap(app.buttons["Back"])
        app.swipeUp()
        UITest.tap(app.buttons["Remove wallet from this device"])
        shot(app, "remove-wallet", theme)
        UITest.tap(app.buttons["Back"])

        UITest.tap(app.buttons["Home"])
        UITest.tap(app.buttons["Lock wallet"].firstMatch)
        UITest.wait(app.staticTexts["Welcome back"])
        shot(app, "unlock", theme)
        UITest.type("wrong passphrase", into: app.secureTextFields["Enter your passphrase"])
        UITest.tap(app.buttons["Unlock"])
        UITest.wait(app.staticTexts["Incorrect passphrase"].firstMatch)
        shot(app, "unlock-failed", theme)

        for state in ["empty", "balanceError"] {
            app.terminate()
            app = UITest.launch(theme: theme, fixtures: state)
            UITest.unlock(app)
            if state == "empty" {
                UITest.wait(UITest.labelled(app, containing: "STRK, 0,"))
            } else {
                UITest.wait(app.staticTexts["RPC endpoints unavailable"])
                XCTAssertTrue(app.buttons["Try again"].exists)
            }
            shot(app, "home-\(state)", theme)
        }
        UITest.removeWallet(app)
    }

    private func createPath(theme: String) {
        var app = UITest.launch(theme: theme)
        UITest.resetToFirstRun(app)
        UITest.tap(app.buttons["Create a new wallet"])
        UITest.setPassphrase(app)
        UITest.tap(app.buttons["Continue"])
        UITest.tap(app.buttons["Add selected account"])
        UITest.wait(app.staticTexts["Save your recovery phrase"])
        // Masked: VoiceOver meets one element that says so, and no word is in the tree.
        let grid = app.otherElements["recovery-grid"]
        UITest.wait(grid, 5)
        XCTAssertEqual(grid.label, "Recovery phrase hidden")
        XCTAssertFalse(app.staticTexts.matching(identifier: "recovery-word-1").firstMatch.exists)
        shot(app, "save-phrase-masked", theme)
        // Reveal only to unlock the next step; never captured.
        UITest.tap(app.buttons["Show recovery phrase"])
        UITest.tap(app.buttons["I saved my phrase"])
        UITest.wait(app.staticTexts["Confirm your backup"])
        shot(app, "confirm-backup", theme)

        // The vault already exists; relaunch into the locked state and clean up.
        app.terminate()
        app = UITest.launch(theme: theme)
        UITest.resetToFirstRun(app)
    }
}
