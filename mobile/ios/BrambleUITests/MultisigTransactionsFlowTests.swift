import XCTest

/// Multisig transactions (M18) on the deployed 1-of-1 `0x123` that `-BrambleStubNetwork` (DEBUG
/// only) records, whose signer is the published phrase's first account: propose a transfer, sign
/// it, see it ready to submit in Transactions, and have a garbage package refused on import. The
/// stub knows no transaction and refuses every write, and the suite never presses Submit.
final class MultisigTransactionsFlowTests: XCTestCase {
    private func expect(_ text: String, in app: XCUIApplication, timeout: TimeInterval = 20) {
        XCTAssertTrue(app.staticTexts[text].firstMatch.waitForExistence(timeout: timeout), "\"\(text)\" shown")
    }

    private func field(_ label: String, in app: XCUIApplication) -> XCUIElement {
        let field = app.textFields[label]
        return field.waitForExistence(timeout: 3) ? field : app.textViews[label]
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testProposeSignAndImport() throws {
        try UITest.refuseRealPhrase()
        let app = XCUIApplication()
        app.launchArguments = [
            "-network", "sepolia", "-uiTestOfflineFixtures", "ready", "-BrambleUITestReset",
            "-BrambleStubNetwork", "YES"
        ]
        app.launch()
        UITest.wait(app.buttons["Add an existing wallet"], UITest.Timeout.firstScreen)
        UITest.importPublicWallet(app)

        UITest.tap(app.buttons["Settings"])
        UITest.tap(app.buttons["Shared accounts"])
        UITest.tap(app.buttons["Add shared account"])
        UITest.type("0x123", into: field("Multisig address", in: app))
        UITest.tap(app.buttons["Add shared account"].firstMatch)
        expect("Multisig synced · 1 wallet signer found", in: app)
        UITest.tap(app.buttons["Back"].firstMatch)
        UITest.tap(app.buttons.matching(NSPredicate(format: "label ENDSWITH '0123'")).firstMatch)

        UITest.tap(app.buttons["Send"])
        expect("New transaction", in: app)
        UITest.type("0x1234", into: field("To", in: app))
        UITest.type("1", into: field("Amount to send", in: app))
        UITest.tap(app.buttons["Review transaction"])
        UITest.tap(app.buttons["Sign reviewed transaction"])
        expect("Exact transaction signed (1/1)", in: app)
        XCTAssertTrue(app.buttons["Submit transaction"].waitForExistence(timeout: 10))
        snapshot(app, "multisig-intent-ready")
        UITest.tap(app.buttons["Back"].firstMatch)

        UITest.tap(app.buttons["Transactions"])
        expect("Waiting for a signature", in: app)
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "value == 'Ready to submit · 1 of 1'")).firstMatch
                .waitForExistence(timeout: 10),
            "the ready intent is listed"
        )
        UITest.tap(app.buttons["Import transaction"])
        UITest.type("not a package", into: field("Intent package", in: app))
        UITest.tap(app.buttons["Verify and import"])
        expect("That package isn't a valid transaction. Ask for a fresh copy.", in: app)
        snapshot(app, "multisig-import-refused")
    }
}
