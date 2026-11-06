import XCTest

/// Account management with no network use: the app is launched with design-mobile's offline
/// fixture node in its `unfunded` state (`-uiTestOfflineFixtures unfunded`), which reports every
/// probed address as undeployed and empty, so discovery selects nothing by itself. Only the
/// published E2E phrase is ever typed.
///
///   xcodebuild … -only-testing:BrambleUITests/AccountsTests test
final class AccountsTests: XCTestCase {
    private let publicPhrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
    private let passphrase = "ui test passphrase"

    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        // Restores the XCTest default that setUp changed; nothing else is shared between tests.
        continueAfterFailure = true
        super.tearDown()
    }

    private func launch(fresh: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-network", "sepolia", "-uiTestOfflineFixtures", "unfunded"]
            + (fresh ? ["-BrambleUITestReset"] : [])
        app.launch()
        if fresh {
            XCTAssertTrue(
                app.buttons["Create a new wallet"].waitForExistence(timeout: 10),
                "Uninstall Bramble from the Bramble accounts simulator before running this suite"
            )
        }
        return app
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tap(_ element: XCUIElement, timeout: TimeInterval = 10) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) exists")
        element.tap()
    }

    /// Taps the one button with this label once a step transition has settled to a single match.
    private func tapSettled(_ app: XCUIApplication, _ label: String) {
        // A fresh simulator's one-time keyboard tip has its own "Continue"; clear it first.
        UITest.dismissKeyboardTip(app)
        let query = app.buttons.matching(identifier: label)
        let deadline = Date().addingTimeInterval(10)
        while query.count != 1, Date() < deadline { usleep(200_000) }
        tap(query.firstMatch)
    }

    private func type(_ text: String, into field: XCUIElement) {
        UITest.type(text, into: field)
    }

    private func setPassphrase(_ app: XCUIApplication, cta: String) {
        type(passphrase, into: app.secureTextFields["Vault passphrase"])
        type(passphrase, into: app.secureTextFields["Confirm passphrase"])
        tapSettled(app, cta)
    }

    /// The active account's name from the header's value ("<name>, <network>").
    private func headerName(_ app: XCUIApplication) -> String {
        let header = app.buttons["Accounts"]
        XCTAssertTrue(header.waitForExistence(timeout: 20))
        let value = header.value as? String ?? ""
        return value.components(separatedBy: ", ").first ?? value
    }

    private func toast(_ app: XCUIApplication, _ text: String) {
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 10), "toast \(text)")
    }

    private func removeWallet(_ app: XCUIApplication) {
        tap(app.buttons["Settings"])
        app.swipeUp()
        tap(app.buttons["Remove wallet from this device"])
        type(passphrase, into: app.secureTextFields["Confirm vault passphrase"])
        tap(app.buttons["Remove wallet"])
        XCTAssertTrue(app.buttons["Create a new wallet"].waitForExistence(timeout: 10))
    }

    /// Create → friendly name (never "Account 1") → add → rename and clear → copy → groups.
    func testCreateNameAddRenameCopyAndGroup() {
        let app = launch(fresh: true)
        createAndConfirmBackup(app)
        let second = nameAndAddAccount(app)
        renameCopyAndClear(app)
        groupActiveAccount(app, named: second)
    }

    /// Create → review → reveal → confirm the backup → open the wallet.
    private func createAndConfirmBackup(_ app: XCUIApplication) {
        tap(app.buttons["Create a new wallet"])
        setPassphrase(app, cta: "Continue")
        XCTAssertTrue(app.staticTexts["Primary Bramble account"].waitForExistence(timeout: 20))
        snapshot(app, "review-account")
        tap(app.buttons["Add selected account"])
        tap(app.buttons["Show recovery phrase"])
        let words = (1...12).map { app.staticTexts.matching(identifier: "recovery-word-\($0)").firstMatch.label }
        tap(app.buttons["I saved my phrase"])
        for (field, position) in zip(["Word 3", "Word 7", "Word 11"], [3, 7, 11]) {
            type(words[position - 1], into: app.textFields[field])
        }
        XCTAssertTrue(app.staticTexts["Backup confirmed."].waitForExistence(timeout: 5))
        tapSettled(app, "Continue")
        tap(app.buttons["Open Bramble"])
    }

    /// The friendly name, the drawer without copy controls, and Add account. Returns the added
    /// account's name.
    private func nameAndAddAccount(_ app: XCUIApplication) -> String {
        let first = headerName(app)
        XCTAssertFalse(first.hasPrefix("Account"), "the extension's nickname, not \(first)")
        XCTAssertEqual(first.split(separator: " ").count, 2)
        snapshot(app, "home-named")

        // Drawer: this network's account, no copy control on rows, then Add account.
        tap(app.buttons["Accounts"])
        XCTAssertTrue(app.staticTexts["Accounts"].waitForExistence(timeout: 5))
        let copies = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Copy'"))
        XCTAssertEqual(copies.count, 0, "drawer rows carry no copy control")
        snapshot(app, "drawer")
        tap(app.buttons["Add account"])
        XCTAssertTrue(app.staticTexts["Add a new account"].waitForExistence(timeout: 5))
        tap(app.buttons["Regular account"])
        toast(app, "Account added")
        let second = headerName(app)
        XCTAssertNotEqual(second, first, "the new account is active")
        return second
    }

    /// Manage: rename, copy the address, then clear back to the nickname.
    private func renameCopyAndClear(_ app: XCUIApplication) {
        tap(app.buttons["Accounts"])
        tap(app.buttons["Manage accounts & groups"])
        XCTAssertTrue(app.staticTexts["Accounts & groups"].waitForExistence(timeout: 5))
        let name = app.textFields["Name"]
        app.swipeUp()
        type("Savings\n", into: name)
        tap(app.buttons["Save name"])
        toast(app, "Label saved")
        snapshot(app, "manage-labelled")
        // The toast sits over the lower rows until its lifetime ends; tap the receipt after it.
        XCTAssertTrue(app.staticTexts["Label saved"].waitForNonExistence(timeout: 10))
        tap(app.buttons["Copy address"])
        toast(app, "Copied")
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 10) + "\n")
        tap(app.buttons["Save name"])
        toast(app, "Label cleared")
    }

    /// Groups: create one, file the active account through the drawer's folder picker.
    private func groupActiveAccount(_ app: XCUIApplication, named second: String) {
        app.swipeDown()
        type("Long term\n", into: app.textFields["New group name"])
        tap(app.buttons["piggyBank"])
        tap(app.buttons["Create group"])
        toast(app, "Group created")
        tap(app.buttons["Back"])
        XCTAssertEqual(headerName(app), second, "clearing the label restores the nickname")
        tap(app.buttons["Accounts"])
        tap(app.buttons["Long term"])
        let emptyGroup = app.staticTexts[
            "No accounts in this group yet. Open an account's folder button to add it."
        ]
        XCTAssertTrue(emptyGroup.waitForExistence(timeout: 5))
        tap(app.buttons["All"])
        tap(app.buttons["No folder — choose one for \(second)"])
        tap(app.buttons.matching(identifier: "folder-option-long-term").firstMatch)
        toast(app, "Moved to folder")
        snapshot(app, "drawer-grouped")
        app.swipeDown(velocity: .fast)
        removeWallet(app)
    }

    /// Import → Find your accounts (stub node) → manual index → a selection is the only restore
    /// gate → kill before restore resumes discovery → restore → switch network projects the account.
    func testImportDiscoverResumeRestoreAndSwitchNetwork() {
        var app = launch(fresh: true)
        tap(app.buttons["Add an existing wallet"])
        tap(app.buttons["Recovery phrase"])
        for (index, word) in publicPhrase.split(separator: " ").enumerated() {
            let field = app.textFields["Word \(index + 1)"]
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            if !field.isHittable { app.swipeUp() }
            field.tap()
            field.typeText(String(word))
        }
        tapSettled(app, "Continue")
        setPassphrase(app, cta: "Find your accounts")

        XCTAssertTrue(app.staticTexts["Find your accounts"].waitForExistence(timeout: 20))
        let done = app.staticTexts["Search complete. Checked 20 indices across every account type."]
        XCTAssertTrue(done.waitForExistence(timeout: 60))
        let restore = app.buttons["Restore selected accounts"]
        XCTAssertFalse(restore.isEnabled, "nothing active, so nothing is auto-selected")
        tap(app.buttons["Bramble accounts"])
        let account0 = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Account 0,'")).firstMatch
        tap(account0)
        XCTAssertTrue(restore.isEnabled, "a selection is enough: there is no acknowledgement to tick")
        app.swipeUp()
        tap(app.buttons["Advanced manual index"])
        type("5", into: app.textFields["Account index"])
        tap(app.buttons["Check this index"])
        let account5 = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Account 5,'")).firstMatch
        XCTAssertTrue(account5.waitForExistence(timeout: 20))
        snapshot(app, "find-accounts")

        // Killed before restoring: unlocking resumes discovery; there is no way into the wallet.
        app.terminate()
        app = launch(fresh: false)
        type(passphrase, into: app.secureTextFields["Enter your passphrase"])
        tap(app.buttons["Unlock"])
        XCTAssertTrue(app.staticTexts["Find your accounts"].waitForExistence(timeout: 20))
        XCTAssertTrue(done.waitForExistence(timeout: 60))
        tap(app.buttons["Bramble accounts"])
        tap(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Account 0,'")).firstMatch)
        app.swipeUp()
        XCTAssertTrue(restore.isEnabled)
        tap(restore)
        toast(app, "1 account restored")
        tap(app.buttons["Open Bramble"])
        let sepoliaName = headerName(app)
        XCTAssertFalse(sepoliaName.hasPrefix("Account"))

        // Switching network projects the account instead of leaving the drawer empty.
        tap(app.buttons["Settings"])
        tap(app.buttons["Network"])
        tap(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Starknet Mainnet'")).firstMatch)
        tap(app.buttons["Back"])
        tap(app.buttons["Home"])
        tap(app.buttons["Accounts"])
        let emptyNetwork = app.staticTexts["No accounts on this network yet. Add one below."]
        XCTAssertFalse(emptyNetwork.waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Starknet Mainnet"].exists)
        snapshot(app, "drawer-mainnet-projected")
        app.swipeDown(velocity: .fast)
        removeWallet(app)
    }
}
