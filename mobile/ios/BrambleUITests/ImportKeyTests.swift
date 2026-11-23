import XCTest

/// "Import private key" from the drawer's Add account, offline (the `unfunded` fixture node): an
/// invalid key and a duplicate show the core's reason, a valid key imports and becomes active, and
/// the field is empty after every attempt and after leaving. Starts from a reset vault and removes
/// the wallet at the end, so the import is not left in the wallet other suites share.
///
/// The key is wallet-core's own test vector (`tests/key_import.rs`, `key_of(LEGAL, 0)`): the
/// published "legal winner" phrase's key at index 0, never a real wallet's. Snapshots are taken
/// only while the field is empty.
///
///   xcodebuild … -only-testing:BrambleUITests/ImportKeyTests test
final class ImportKeyTests: XCTestCase {
    private let legalKey = "0x49ad2aeccec5cc04038494d378717b5ad1f42003d5507f840da0476eda6c3fc" // gitleaks:allow
    private let fieldLabel = "Raw Starknet private key"

    override func setUpWithError() throws {
        try UITest.refuseRealPhrase()
        continueAfterFailure = false
    }

    override func tearDown() {
        // Restores the XCTest default that setUp changed; nothing else is shared between tests.
        continueAfterFailure = true
        super.tearDown()
    }

    func testInvalidLeaveImportAndDuplicate() {
        let app = UITest.launch(fixtures: "unfunded", extra: ["-BrambleUITestReset"])
        UITest.importPublicWallet(app)
        let first = headerName(app)

        openImportKey(app, shoot: true)
        UITest.type("0x0", into: field(app))
        UITest.tap(app.buttons["Import account"])
        UITest.wait(app.staticTexts["Invalid private key"])
        assertEmpty(app)
        snapshot(app, "import-key-invalid")

        // Leaving drops the key: back to the chooser and in again finds the field empty.
        UITest.type(legalKey, into: field(app))
        UITest.tap(app.buttons["Back"])
        UITest.tap(app.buttons["Private key"])
        assertEmpty(app)

        // A valid key: the sheet closes on the new, active account, listed in the drawer.
        UITest.type(legalKey, into: field(app))
        UITest.tap(app.buttons["Import account"])
        UITest.wait(app.staticTexts["Account imported"])
        let imported = headerName(app)
        XCTAssertNotEqual(imported, first, "the imported account is active")
        UITest.tap(app.buttons["Accounts"])
        UITest.wait(UITest.labelled(app, containing: imported))
        UITest.wait(UITest.labelled(app, containing: first))
        snapshot(app, "drawer-imported")

        // The same key again is refused in the core's words, and the field is emptied.
        UITest.tap(app.buttons["Add account"])
        UITest.tap(app.buttons["Import an existing account"])
        UITest.tap(app.buttons["Private key"])
        assertEmpty(app)
        UITest.type(legalKey, into: field(app))
        UITest.tap(app.buttons["Import account"])
        UITest.wait(app.staticTexts["Account already exists"])
        assertEmpty(app)
        // Out through the sheet's own controls (a swipe only drops the keyboard).
        UITest.tap(app.buttons["Back"])
        UITest.tap(app.buttons["Back"])
        UITest.tap(app.buttons["Close Add account"])
        UITest.tap(app.buttons["Close accounts"])
        XCTAssertEqual(headerName(app), imported)
        UITest.removeWallet(app)
    }

    /// Drawer → Add account → Import an existing account → Private key.
    private func openImportKey(_ app: XCUIApplication, shoot: Bool = false) {
        UITest.tap(app.buttons["Accounts"])
        UITest.tap(app.buttons["Add account"])
        UITest.tap(app.buttons["Import an existing account"])
        UITest.wait(app.buttons["Private key"])
        if shoot { snapshot(app, "import-chooser") }
        UITest.tap(app.buttons["Private key"])
        UITest.wait(app.staticTexts["Import private key"])
        if shoot { snapshot(app, "import-key-form") }
    }

    /// The key field: a vertical text field, which XCUITest may list as a text view.
    private func field(_ app: XCUIApplication) -> XCUIElement {
        let field = app.textFields[fieldLabel]
        return field.waitForExistence(timeout: 3) ? field : app.textViews[fieldLabel]
    }

    /// The field holds nothing typed: its value is empty or the placeholder.
    private func assertEmpty(_ app: XCUIApplication, line: UInt = #line) {
        let value = field(app).value as? String ?? ""
        let empty = value.isEmpty || value == "0x…"
        XCTAssertTrue(empty, "the key field is empty, not \(value.count) characters", line: line)
    }

    /// The active account's name from the header's value ("<name>, <network>").
    private func headerName(_ app: XCUIApplication) -> String {
        let header = app.buttons["Accounts"]
        UITest.wait(header)
        let value = header.value as? String ?? ""
        return value.components(separatedBy: ", ").first ?? value
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
