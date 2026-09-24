import XCTest

/// Drives the portfolio and activity screens against the debug fixture network
/// (`-BrambleUITestNetworkStub <scenario>`, compiled only into debug builds), so every value is
/// deterministic and no request reaches a real price, explorer or RPC endpoint. Scenarios mirror
/// the extension's portfolio stories: ready, saved-data, balance-error (via a fresh account),
/// prices-offline and history-unavailable. Nothing is signed or broadcast.
///
/// Runs on the dedicated simulator ("Bramble portfolio-activity"). A wallet left installed by an
/// earlier suite is removed first. The wallet is the repository's published E2E phrase.
final class PortfolioActivityTests: XCTestCase {
    private let phrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
    private let passphrase = "ui test passphrase"

    private func tap(_ element: XCUIElement, timeout: TimeInterval = 15) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) exists")
        element.tap()
    }

    /// Taps the first hittable match (a transition can briefly keep a second copy in the tree).
    private func tapHittable(_ query: XCUIElementQuery, timeout: TimeInterval = 15) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let hittable = query.allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.isEnabled }
            if let element = hittable {
                element.tap()
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        XCTFail("no hittable \(query)")
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func launch(_ app: XCUIApplication, scenario: String, freshCaches: Bool = false) {
        app.launchArguments = [
            "-network", "mainnet", "-BrambleUITestNetworkStub", scenario,
            "-BrambleUITestFreshCaches", freshCaches ? "YES" : "NO"
        ]
        app.launch()
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// Waits until an element's accessibility value satisfies a predicate.
    private func waitForValue(
        _ element: XCUIElement,
        timeout: TimeInterval = 20,
        _ matches: (String) -> Bool
    ) -> String {
        let deadline = Date().addingTimeInterval(timeout)
        var last = ""
        while Date() < deadline {
            last = (element.value as? String) ?? ""
            if element.exists, matches(last) { return last }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        XCTFail("\(element) value never matched; last was \(last)")
        return last
    }

    /// A wallet left by an earlier suite (OnboardingFlowTests uses the same passphrase) is removed
    /// through the app's own "Remove wallet" flow, so the whole UI target runs in one invocation.
    private func removeExistingWallet(_ app: XCUIApplication) {
        let welcome = app.buttons["Add an existing wallet"]
        let lock = app.secureTextFields["Enter your passphrase"]
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline, !welcome.exists, !lock.exists {
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        guard lock.exists else { return }
        unlock(app)
        tap(app.buttons["Settings"], timeout: 20)
        let remove = app.buttons["Remove wallet from this device"]
        if !remove.waitForExistence(timeout: 5) { app.swipeUp() }
        tap(remove)
        let confirm = app.secureTextFields["Confirm vault passphrase"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        confirm.typeText(passphrase)
        tapHittable(app.buttons.matching(identifier: "Remove wallet"))
    }

    private func importWallet(_ app: XCUIApplication) {
        removeExistingWallet(app)
        XCTAssertTrue(
            app.buttons["Add an existing wallet"].waitForExistence(timeout: 15),
            "onboarding starts from an empty device"
        )
        tap(app.buttons["Add an existing wallet"])
        tap(app.buttons["Recovery phrase"])
        for (index, word) in phrase.split(separator: " ").enumerated() {
            let field = app.textFields["Word \(index + 1)"]
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            if !field.isHittable { app.swipeUp() }
            field.tap()
            field.typeText(String(word))
        }
        tapHittable(app.buttons.matching(identifier: "Continue"))
        for label in ["Vault passphrase", "Confirm passphrase"] {
            let field = app.secureTextFields[label]
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            field.tap()
            field.typeText(passphrase)
        }
        tap(app.buttons["Find your accounts"])
        tap(app.buttons["I understand this wallet can hold real funds on Starknet Mainnet."], timeout: 30)
        tap(app.buttons["Add selected account"])
        tap(app.buttons["Open Bramble"], timeout: 20)
    }

    private func unlock(_ app: XCUIApplication) {
        let field = app.secureTextFields["Enter your passphrase"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(passphrase)
        tap(app.buttons["Unlock"])
    }

    /// Relaunches the installed wallet under another scenario, starting from empty caches.
    private func relaunch(_ app: XCUIApplication, scenario: String) {
        app.terminate()
        launch(app, scenario: scenario, freshCaches: true)
        unlock(app)
    }

    private func refreshPortfolio(_ app: XCUIApplication) {
        tap(app.buttons["Home"])
        tap(app.buttons["Portfolio actions"])
        tap(app.buttons["Refresh portfolio"])
    }

    func testPortfolioAndActivityStories() {
        let app = XCUIApplication()
        launch(app, scenario: "ready")
        importWallet(app)
        let total = element(app, "portfolio-total")
        heroStory(app, total: total)
        manageTokensStory(app)
        currencyStory(app, total: total)
        activityStory(app)
        degradedStories(app, total: total)
        removeWalletAtEnd(app)
    }

    /// (1) Hero total and the 24h line, rows with fiat and badges.
    private func heroStory(_ app: XCUIApplication, total: XCUIElement) {
        XCTAssertEqual(waitForValue(total) { $0 == "$1,242.25" }, "$1,242.25")
        XCTAssertTrue(element(app, "portfolio-change").waitForExistence(timeout: 5))
        XCTAssertTrue((element(app, "portfolio-change").label).contains("% · 24h"))
        XCTAssertTrue(element(app, "token-row-STRK").exists && element(app, "token-row-ETH").exists)
        snapshot(app, "home-ready")
    }

    /// (2) Manage tokens: hide STRK, see "1 not shown", show it again. (3) Add by contract, then
    /// find held tokens.
    private func manageTokensStory(_ app: XCUIApplication) {
        tap(app.buttons["Portfolio actions"])
        tap(app.buttons["Manage tokens"])
        XCTAssertTrue(app.staticTexts["2 tracked"].waitForExistence(timeout: 5))
        tap(app.buttons["Hide STRK"])
        XCTAssertTrue(app.buttons["Show STRK"].waitForExistence(timeout: 5))
        snapshot(app, "tokens")
        tap(app.buttons["Back"])
        let manage = app.buttons["Manage tokens"]
        XCTAssertEqual(waitForValue(manage) { $0 == "1 not shown" }, "1 not shown")
        tap(manage)
        tap(app.buttons["Show STRK"])
        XCTAssertTrue(app.buttons["Hide STRK"].waitForExistence(timeout: 5))

        // (3) Add by contract, then find held tokens.
        tap(app.buttons["Add by contract"])
        let field = app.textFields["Contract address"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("0xabc")
        tap(app.buttons["Read and add token"])
        XCTAssertTrue(element(app, "tracked-TST").waitForExistence(timeout: 15), "the read token is tracked")
        XCTAssertTrue(app.staticTexts["3 tracked"].exists)
        tap(app.buttons["Find held tokens"])
        tap(app.buttons["Scan for tokens"])
        XCTAssertTrue(app.staticTexts["1 found."].waitForExistence(timeout: 15))
        snapshot(app, "discover")
        tap(app.buttons["Add USDC"])
        XCTAssertTrue(app.staticTexts["Token added"].waitForExistence(timeout: 15))
        tap(app.buttons["Back"])
        tap(app.buttons["Back"])
    }

    /// (4) Appearance & currency → EUR.
    private func currencyStory(_ app: XCUIApplication, total: XCUIElement) {
        tap(app.buttons["Settings"])
        tap(app.buttons["Appearance & currency"])
        XCTAssertTrue(app.buttons["Dark"].exists, "the Theme section stays")
        tap(app.buttons["EUR"])
        snapshot(app, "appearance-currency")
        tap(app.buttons["Back"])
        XCTAssertEqual(app.buttons["Appearance & currency"].value as? String, "EUR")
        tap(app.buttons["Home"])
        _ = waitForValue(total) { $0.hasPrefix("€") }
    }

    /// (5) Activity: grouped rows linked to the explorer, with a copy control.
    private func activityStory(_ app: XCUIApplication) {
        tap(app.buttons["Activity"])
        let received = element(app, "activity-link-0xabc1")
        XCTAssertTrue(received.waitForExistence(timeout: 20))
        XCTAssertEqual(received.value as? String, "https://starkscan.co/tx/0xabc1")
        XCTAssertTrue(received.label.hasPrefix("Received 1.5 STRK from 0x5a1b…7e8f."))
        XCTAssertTrue(received.label.hasSuffix("View transaction on Starkscan"))
        XCTAssertTrue(element(app, "activity-link-0xabc2").exists)
        tap(app.buttons["Copy sender address"].firstMatch)
        snapshot(app, "activity")
    }

    /// Prices offline, saved data, balance error, and history unavailable, each from a relaunch.
    private func degradedStories(_ app: XCUIApplication, total: XCUIElement) {
        // (7) prices-offline: balances load, prices do not; the header says so and the hero is "—".
        let accounts = app.buttons["Accounts"]
        relaunch(app, scenario: "prices-offline")
        _ = waitForValue(accounts) { $0 == "Live prices are temporarily unavailable." }
        XCTAssertEqual(waitForValue(total) { $0 == "Unavailable" }, "Unavailable")
        XCTAssertTrue(element(app, "token-row-STRK").exists, "balances still render")
        snapshot(app, "prices-offline")

        // saved-data: the first read answers, the forced one fails; balances stay, marked saved.
        relaunch(app, scenario: "saved-data")
        XCTAssertTrue(element(app, "token-row-STRK").waitForExistence(timeout: 30))
        refreshPortfolio(app)
        _ = waitForValue(accounts) { $0.hasPrefix("Using saved balances (") }
        XCTAssertTrue(element(app, "token-row-STRK").exists, "a failed refresh never blanks saved balances")
        snapshot(app, "saved-data")

        // balance-error: nothing saved, every endpoint unreachable: the error panel and its retry.
        relaunch(app, scenario: "balance-error")
        XCTAssertTrue(app.buttons["Retry loading balances"].waitForExistence(timeout: 60))
        let unreachable = app.staticTexts["Couldn't reach the network. Check your connection or RPC endpoint."]
        XCTAssertTrue(unreachable.exists)
        _ = waitForValue(accounts) { $0.hasPrefix("Balances are temporarily unavailable.") }
        snapshot(app, "balance-error")

        // (6) history-unavailable: the notice and the device-only empty copy.
        relaunch(app, scenario: "history-unavailable")
        tap(app.buttons["Activity"], timeout: 20)
        XCTAssertTrue(element(app, "history-unavailable").waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["No transactions recorded on this device yet."].waitForExistence(timeout: 5))
        snapshot(app, "history-unavailable")
    }

    /// Leaves the simulator clean through the real removal path.
    private func removeWalletAtEnd(_ app: XCUIApplication) {
        tap(app.buttons["Settings"])
        app.swipeUp()
        tap(app.buttons["Remove wallet from this device"])
        let confirm = app.secureTextFields["Confirm vault passphrase"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        confirm.typeText(passphrase)
        tap(app.buttons["Remove wallet"])
        XCTAssertTrue(app.buttons["Add an existing wallet"].waitForExistence(timeout: 15))
    }
}
