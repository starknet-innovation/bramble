import XCTest

/// Shared driving for the offline UI suites (snapshots, swipe-back, hit targets). They run on
/// Sepolia with the Debug-only fixture transport, so no request reaches a live host, and they only
/// ever import the repository's published E2E phrase. A real phrase is refused.
enum UITest {
    static let publicPhrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
    static let passphrase = "ui test passphrase"

    /// How long each kind of wait allows, in seconds.
    enum Timeout {
        /// Any screen element the flow expects next.
        static let element: TimeInterval = 20
        /// A field or row already on the current screen.
        static let onScreen: TimeInterval = 5
        /// The first screen after launch.
        static let firstScreen: TimeInterval = 10
        /// The unlock screen, checked once the welcome screen did not appear.
        static let lockedScreen: TimeInterval = 5
        /// The whole "Find your accounts" search over the fixture node.
        static let accountSearch: TimeInterval = 90
    }

    /// The leading-edge swipe: normalized start and end x, the row it runs along, and the press.
    private enum EdgeSwipe {
        static let startX: CGFloat = 0.01
        static let endX: CGFloat = 0.85
        static let rowY: CGFloat = 0.55
        static let pressDuration: TimeInterval = 0.05
    }

    /// Refuses to run when a real phrase is present in the environment.
    static func refuseRealPhrase() throws {
        if ProcessInfo.processInfo.environment["BRAMBLE_MOBILE_MAINNET_MNEMONIC"] != nil {
            throw XCTSkip("The offline suites never run with BRAMBLE_MOBILE_MAINNET_MNEMONIC set")
        }
    }

    /// Launches offline (Sepolia unless `network` says otherwise) against the fixture node in state
    /// `fixtures`; `theme` pins the skin through the argument domain, and `extra` adds a suite's own
    /// DEBUG fixtures (the privacy service's, for one).
    static func launch(
        theme: String? = nil,
        fixtures: String = "ready",
        network: String = "sepolia",
        extra: [String] = []
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-network", network, "-uiTestOfflineFixtures", fixtures] + extra
        if let theme { app.launchArguments += ["-theme", theme] }
        app.launch()
        return app
    }

    /// Opens the wallet a suite shares between its tests: unlocks the one an earlier test left, or
    /// imports the published phrase on a fresh install. A created wallet another suite left behind
    /// (still pending its backup) is removed first, so the fixtures always see the published wallet.
    static func openWallet(_ app: XCUIApplication) {
        let welcome = app.buttons["Add an existing wallet"]
        let locked = app.staticTexts["Welcome back"]
        _ = welcome.waitForExistence(timeout: Timeout.firstScreen)
            || locked.waitForExistence(timeout: Timeout.lockedScreen)
        if locked.exists {
            type(passphrase, into: app.secureTextFields["Enter your passphrase"])
            tap(app.buttons["Unlock"])
            if awaitUnlocked(app) == .home {
                waitForWallet(app)
                return
            }
            removeUnlockedWallet(app)
        }
        importPublicWallet(app)
    }

    static func wait(
        _ element: XCUIElement,
        _ timeout: TimeInterval = Timeout.element,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) exists", file: file, line: line)
    }

    static func tap(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        wait(element, file: file, line: line)
        element.tap()
    }

    static func type(_ text: String, into field: XCUIElement) {
        wait(field, Timeout.onScreen)
        field.tap()
        field.typeText(text)
        dismissKeyboardTip(XCUIApplication())
    }

    /// A fresh simulator shows a one-time keyboard tip ("Type English and …") with its own
    /// Continue button; clear it so it never shadows the app's CTA.
    static func dismissKeyboardTip(_ app: XCUIApplication) {
        let tip = app.keyboards.buttons["Continue"]
        if tip.exists { tip.tap() }
        let other = app.buttons.matching(NSPredicate(format: "label == 'Continue'"))
        let tipText = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Type English'"))
        if other.count > 1, tipText.firstMatch.exists {
            // The tip's button is not always last: never tap the app's own Continue (the main
            // window's), or the flow advances behind the caller's back.
            let own = app.windows.element(boundBy: 0).buttons["Continue"]
            let ownFrame = own.exists ? own.frame : .null
            for index in 0..<other.count where other.element(boundBy: index).frame != ownFrame {
                other.element(boundBy: index).tap()
                break
            }
        }
    }

    /// Returns the app to first run: a locked vault left by an earlier run is unlocked with the
    /// test passphrase and removed through the real removal path.
    static func resetToFirstRun(_ app: XCUIApplication) {
        let create = app.buttons["Create a new wallet"]
        let locked = app.staticTexts["Welcome back"]
        _ = create.waitForExistence(timeout: Timeout.firstScreen)
            || locked.waitForExistence(timeout: Timeout.lockedScreen)
        if locked.exists {
            type(passphrase, into: app.secureTextFields["Enter your passphrase"])
            tap(app.buttons["Unlock"])
            removeUnlockedWallet(app)
        }
        wait(create)
    }

    /// Where an unlock lands.
    enum Unlocked {
        case home
        /// A created wallet whose backup is still pending (vault v4) resumes at "Save your recovery
        /// phrase" after every unlock and never reaches Home until the backup is confirmed.
        case pendingBackup
    }

    /// Waits after Unlock for Home or the resumed backup.
    static func awaitUnlocked(_ app: XCUIApplication) -> Unlocked {
        let header = app.buttons["Accounts"]
        let savePhrase = app.staticTexts["Save your recovery phrase"]
        let deadline = Date().addingTimeInterval(Timeout.element)
        while !header.exists, !savePhrase.exists, Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(pollInterval))
        }
        return savePhrase.exists ? .pendingBackup : .home
    }

    /// Removes the wallet just unlocked through the real removal path, completing a pending backup
    /// first, as a user would.
    static func removeUnlockedWallet(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        if awaitUnlocked(app) == .pendingBackup { completePendingBackup(app) }
        waitForWallet(app, file: file, line: line)
        removeWallet(app)
    }

    /// Save phrase → Confirm your backup → complete → Home for a created (throwaway) wallet: reveals
    /// the phrase, reads the words back from the grid, and types the ones the confirm step asks for.
    /// Nothing is captured while the phrase is shown.
    static func completePendingBackup(_ app: XCUIApplication) {
        tap(app.buttons["Show recovery phrase"])
        let cells = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", recoveryWordPrefix))
        wait(cells.firstMatch, Timeout.onScreen)
        var words: [String: String] = [:]
        for index in 0..<cells.count {
            let cell = cells.element(boundBy: index)
            words[String(cell.identifier.dropFirst(recoveryWordPrefix.count))] = cell.label
        }
        tap(app.buttons["I saved my phrase"])
        wait(app.staticTexts["Confirm your backup"])
        let fields = app.textFields.matching(NSPredicate(format: "label BEGINSWITH %@", confirmWordPrefix))
        for index in 0..<fields.count {
            let field = fields.element(boundBy: index)
            field.tap()
            field.typeText(words[String(field.label.dropFirst(confirmWordPrefix.count))] ?? "")
            dismissKeyboardTip(app)
        }
        wait(app.staticTexts["Backup confirmed."], Timeout.onScreen)
        tap(app.windows.element(boundBy: 0).buttons["Continue"])
        wait(app.staticTexts["You’re all set"])
        tap(app.buttons["Open Bramble"])
    }

    /// The identifier prefix of a revealed recovery-grid word ("recovery-word-3").
    private static let recoveryWordPrefix = "recovery-word-"
    /// The label prefix of a confirm-backup field ("Word 3").
    private static let confirmWordPrefix = "Word "
    /// How often a wait for one of several screens re-reads the tree, in seconds.
    private static let pollInterval: TimeInterval = 0.25

    static func unlock(_ app: XCUIApplication) {
        type(passphrase, into: app.secureTextFields["Enter your passphrase"])
        tap(app.buttons["Unlock"])
        waitForWallet(app)
    }

    /// Waits for Home: the header names the active account the extension's way (its label or its
    /// nickname, never "Account 1").
    static func waitForWallet(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let header = app.buttons["Accounts"]
        wait(header, file: file, line: line)
        let name = header.value as? String ?? ""
        XCTAssertFalse(name.isEmpty || name.hasPrefix("Account "), "header shows \(name)", file: file, line: line)
    }

    /// The published wallet's primary account as "Find your accounts" titles it.
    static let primaryCandidate = "Account 0, 0x2083…98d9"

    /// "Find your accounts" over the fixture node, which knows only the published wallet's primary
    /// account: waits for the search, keeps that account selected (a funded or deployed state
    /// selects it automatically; `unfunded` leaves it to the user, as the extension does), and
    /// restores: a selection is the only gate. `shot` captures the review before the restore.
    static func restorePrimaryAccount(_ app: XCUIApplication, shot: (() -> Void)? = nil) {
        wait(app.staticTexts["Find your accounts"])
        wait(app.staticTexts["Search complete. Checked 20 indices across every account type."], Timeout.accountSearch)
        let group = app.buttons["Bramble accounts"]
        if (group.value as? String) != "Expanded" { tap(group) }
        let row = app.buttons[primaryCandidate]
        wait(row, Timeout.onScreen)
        if !row.isSelected { row.tap() }
        shot?()
        let restore = app.buttons["Restore selected accounts"]
        if !restore.isHittable { app.swipeUp() }
        tap(restore)
        wait(app.staticTexts["You’re all set"])
    }

    static func removeWallet(_ app: XCUIApplication) {
        tap(app.buttons["Settings"])
        app.swipeUp()
        tap(app.buttons["Remove wallet from this device"])
        type(passphrase, into: app.secureTextFields["Confirm vault passphrase"])
        tap(app.buttons["Remove wallet"])
        wait(app.buttons["Create a new wallet"])
    }

    /// Types the published phrase one word per cell.
    static func enterPublicPhrase(_ app: XCUIApplication) {
        for (index, word) in publicPhrase.split(separator: " ").enumerated() {
            let field = app.textFields["Word \(index + 1)"]
            wait(field, Timeout.onScreen)
            if !field.isHittable { app.swipeUp() }
            field.tap()
            field.typeText(String(word))
            if index == 0 { dismissKeyboardTip(app) }
        }
        dismissKeyboardTip(app)
    }

    static func setPassphrase(_ app: XCUIApplication) {
        type(passphrase, into: app.secureTextFields["Vault passphrase"])
        type(passphrase, into: app.secureTextFields["Confirm passphrase"])
    }

    /// Welcome → import → passphrase → find your accounts → complete → home, with no capture.
    static func importPublicWallet(_ app: XCUIApplication) {
        tap(app.buttons["Add an existing wallet"])
        tap(app.buttons["Recovery phrase"])
        enterPublicPhrase(app)
        tap(app.buttons["Continue"])
        setPassphrase(app)
        tap(app.buttons["Find your accounts"])
        restorePrimaryAccount(app)
        tap(app.buttons["Open Bramble"])
        waitForWallet(app)
    }

    /// Any element whose accessibility label contains `text`.
    static func labelled(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// A drag from the leading screen edge to 85% of the width.
    static func edgeSwipe(_ app: XCUIApplication) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: EdgeSwipe.startX, dy: EdgeSwipe.rowY))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: EdgeSwipe.endX, dy: EdgeSwipe.rowY))
        start.press(forDuration: EdgeSwipe.pressDuration, thenDragTo: end)
    }

    /// A screen coordinate in points.
    static func point(_ app: XCUIApplication, _ pointX: CGFloat, _ pointY: CGFloat) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: pointX, dy: pointY))
    }

    static var deviceName: String {
        (ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? "device")
            .replacingOccurrences(of: " ", with: "-")
    }
}
