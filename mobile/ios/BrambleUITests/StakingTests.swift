import XCTest

/// Staking (M21), offline: where the core's policy turns staking off (Sepolia) neither Home nor the
/// STRK screen offers it; on Mainnet Home opens the staking screen, whose Starkscan and chain reads
/// fail offline into the core's own sentences, and the paste field refuses a malformed address.
/// The fixture node answers JSON-RPC only and refuses every write, so nothing is ever broadcast.
final class StakingTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try UITest.refuseRealPhrase()
    }

    override func tearDownWithError() throws {
        // Restores the XCTest default that setUp changed; nothing else is shared between tests.
        continueAfterFailure = true
        try super.tearDownWithError()
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(name)-\(UITest.deviceName)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testSepoliaOffersNoStaking() {
        let app = UITest.launch()
        UITest.openWallet(app)
        app.swipeUp()
        XCTAssertFalse(app.buttons["Staking"].waitForExistence(timeout: UITest.Timeout.onScreen))
        app.swipeDown()
        UITest.tap(app.descendants(matching: .any)["token-row-STRK"].firstMatch)
        UITest.wait(app.buttons["Send"])
        XCTAssertFalse(app.buttons["Stake"].exists)
    }

    func testMainnetOpensStakingAndRefusesABadAddress() {
        let app = UITest.launch(network: "mainnet")
        UITest.openWallet(app)
        app.swipeUp()
        UITest.tap(app.buttons["Staking"])
        UITest.wait(app.staticTexts["Couldn't load the validator list. Paste a validator address instead."])
        let field = app.textFields["Validator address"]
        UITest.type("0xnot-an-address", into: field)
        UITest.tap(app.buttons["Open"])
        UITest.wait(app.staticTexts["Enter a valid Starknet address."])
        snapshot(app, "staking-offline")
    }
}
