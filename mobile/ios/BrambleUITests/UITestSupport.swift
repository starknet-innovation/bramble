import XCTest

/// Shared driving for the offline UI suites (snapshots, swipe-back, hit targets). They run on
/// Sepolia with the Debug-only fixture transport, so no request reaches a live host, and they only
/// ever import the repository's published E2E phrase. A real phrase is refused.
enum UITest {
    static let publicPhrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
    static let passphrase = "ui test passphrase"

    /// Refuses to run when a real phrase is present in the environment.
    static func refuseRealPhrase() throws {
        if ProcessInfo.processInfo.environment["BRAMBLE_MOBILE_MAINNET_MNEMONIC"] != nil {
            throw XCTSkip("The offline suites never run with BRAMBLE_MOBILE_MAINNET_MNEMONIC set")
        }
    }

    /// Launches offline on Sepolia; `theme` pins the skin through the argument domain.
    static func launch(theme: String? = nil, fixtures: String = "ready") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-network", "sepolia", "-uiTestOfflineFixtures", fixtures]
        if let theme { app.launchArguments += ["-theme", theme] }
        app.launch()
        return app
    }

    static func wait(_ element: XCUIElement, _ timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) exists", file: file, line: line)
    }

    static func tap(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        wait(element, file: file, line: line)
        element.tap()
    }

    static func type(_ text: String, into field: XCUIElement) {
        wait(field, 5)
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
        if other.count > 1, app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Type English'")).firstMatch.exists {
            other.element(boundBy: other.count - 1).tap()
        }
    }

    /// Returns the app to first run: a locked vault left by an earlier run is unlocked with the
    /// test passphrase and removed through the real removal path.
    static func resetToFirstRun(_ app: XCUIApplication) {
        let create = app.buttons["Create a new wallet"]
        let locked = app.staticTexts["Welcome back"]
        _ = create.waitForExistence(timeout: 10) || locked.waitForExistence(timeout: 5)
        if locked.exists {
            unlock(app)
            removeWallet(app)
        }
        wait(create)
    }

    static func unlock(_ app: XCUIApplication) {
        type(passphrase, into: app.secureTextFields["Enter your passphrase"])
        tap(app.buttons["Unlock"])
        wait(app.staticTexts["Account 1"])
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
            wait(field, 5)
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

    /// Welcome → import → passphrase → review → complete → home, with no capture.
    static func importPublicWallet(_ app: XCUIApplication) {
        tap(app.buttons["Add an existing wallet"])
        tap(app.buttons["Recovery phrase"])
        enterPublicPhrase(app)
        tap(app.buttons["Continue"])
        setPassphrase(app)
        tap(app.buttons["Find your accounts"])
        tap(app.buttons["Add selected account"])
        tap(app.buttons["Open Bramble"])
        wait(app.staticTexts["Account 1"])
    }

    /// Any element whose accessibility label contains `text`.
    static func labelled(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// A drag from the leading screen edge to 85% of the width.
    static func edgeSwipe(_ app: XCUIApplication) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.55))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    /// A screen coordinate in points.
    static func point(_ app: XCUIApplication, _ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
    }

    static var deviceName: String {
        (ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? "device")
            .replacingOccurrences(of: " ", with: "-")
    }
}
