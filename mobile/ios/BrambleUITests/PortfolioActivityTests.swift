import XCTest

/// Drives the portfolio and activity screens against the debug fixture network
/// (`-BrambleUITestNetworkStub <scenario>`, compiled only into debug builds), so every value is
/// deterministic and no request reaches a real price, explorer or RPC endpoint. Scenarios mirror
/// the extension's portfolio stories: ready, saved-data, balance-error (via a fresh account),
/// prices-offline and history-unavailable. Nothing is signed or broadcast.
///
/// A wallet left installed by an earlier suite is removed first (`UITest.resetToFirstRun`), then the
/// repository's published E2E phrase is imported through the shared onboarding helpers.
final class PortfolioActivityTests: XCTestCase {
    private func tap(_ element: XCUIElement, timeout: TimeInterval = 15) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) exists")
        element.tap()
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func launch(_ app: XCUIApplication, scenario: String, freshCaches: Bool = false) {
        // The offline fixture node answers the account search and deployment reads (and keeps the
        // privacy read offline); the portfolio stub answers balances, prices and history.
        app.launchArguments = [
            "-network", "mainnet", "-uiTestOfflineFixtures", "ready", "-BrambleUITestNetworkStub", scenario,
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

    /// Relaunches the installed wallet under another scenario, starting from empty caches.
    private func relaunch(_ app: XCUIApplication, scenario: String) {
        app.terminate()
        launch(app, scenario: scenario, freshCaches: true)
        UITest.unlock(app)
    }

    private func refreshPortfolio(_ app: XCUIApplication) {
        tap(app.buttons["Home"])
        tap(app.buttons["Portfolio actions"])
        tap(app.buttons["Refresh portfolio"])
    }

    func testPortfolioAndActivityStories() {
        let app = XCUIApplication()
        launch(app, scenario: "ready")
        UITest.resetToFirstRun(app)
        UITest.importPublicWallet(app)
        let total = element(app, "portfolio-total")
        heroStory(app, total: total)
        manageTokensStory(app)
        currencyStory(app, total: total)
        activityStory(app)
        degradedStories(app, total: total)
        UITest.removeWallet(app)
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
        XCTAssertTrue((app.buttons["Appearance & currency"].value as? String ?? "").hasSuffix("· EUR"))
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
        // The header's accessibility value is "<account>, <network>, <status>".
        let accounts = app.buttons["Accounts"]
        relaunch(app, scenario: "prices-offline")
        _ = waitForValue(accounts) { $0.contains("Live prices are temporarily unavailable.") }
        XCTAssertEqual(waitForValue(total) { $0 == "Unavailable" }, "Unavailable")
        XCTAssertTrue(element(app, "token-row-STRK").exists, "balances still render")
        snapshot(app, "prices-offline")

        // saved-data: the first read answers, the forced one fails; balances stay, marked saved.
        relaunch(app, scenario: "saved-data")
        XCTAssertTrue(element(app, "token-row-STRK").waitForExistence(timeout: 30))
        refreshPortfolio(app)
        _ = waitForValue(accounts) { $0.contains("Using saved balances (") }
        XCTAssertTrue(element(app, "token-row-STRK").exists, "a failed refresh never blanks saved balances")
        snapshot(app, "saved-data")

        // balance-error: nothing saved, every endpoint unreachable: the error panel and its retry.
        relaunch(app, scenario: "balance-error")
        XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: 60), "the error panel's retry")
        let unreachable = app.staticTexts["Couldn't reach the network. Check your connection or RPC endpoint."]
        XCTAssertTrue(unreachable.exists)
        _ = waitForValue(accounts) { $0.contains("Balances are temporarily unavailable.") }
        snapshot(app, "balance-error")

        // (6) history-unavailable: the core's activity log already holds this account's feed from
        // story (5), so history is not due on opening; the Refresh control forces the read, no lane
        // answers, and the notice appears above the saved rows, which a failed read never blanks.
        relaunch(app, scenario: "history-unavailable")
        tap(app.buttons["Activity"], timeout: 20)
        tap(app.buttons["Refresh transactions"], timeout: 20)
        XCTAssertTrue(element(app, "history-unavailable").waitForExistence(timeout: 60))
        XCTAssertTrue(element(app, "activity-link-0xabc1").exists, "saved rows stay")
        snapshot(app, "history-unavailable")
    }
}
