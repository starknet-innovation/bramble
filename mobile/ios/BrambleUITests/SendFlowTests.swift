import XCTest

/// Walks the Send journey on a simulator against design-mobile's offline fixture transport
/// (`-uiTestOfflineFixtures <state>`, answering from `RpcFixtures.generated.swift`, which carries
/// the node replies recorded from the extension's own send path), so nothing touches a network:
/// recipient validation, amount gates and Max, the review (fee lines, copy button, Edit), the
/// fee-failure and poisoning blocks, and the home deploy notice. It stops at "Confirm and send":
/// that button is asserted, never tapped, and the fixture node must report zero writes.
final class SendFlowTests: XCTestCase {
    private let recipient = "0x3fa78c2861131190760b151f3ee110f473940eca3fec8cc423ecc307b5241a3"
    private let lookalike = "0x2083610000000000000000000000000000000000000000000000000000098d9"

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
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tap(_ element: XCUIElement) {
        UITest.tap(element)
    }

    private func type(_ text: String, into field: XCUIElement) {
        UITest.type(text, into: field)
    }

    /// Launches offline on Sepolia in the fixture `state`, importing the published phrase on a
    /// fresh install or unlocking the wallet an earlier test left.
    private func launch(_ state: String) -> XCUIApplication {
        let app = UITest.launch(fixtures: state)
        UITest.openWallet(app)
        return app
    }

    private func openSendDetails(_ app: XCUIApplication, to address: String) {
        tap(app.buttons["Send"])
        XCTAssertTrue(app.staticTexts["Send to"].waitForExistence(timeout: 5))
        type(address, into: app.textFields["Recipient address or saved name"])
        tap(app.buttons["Continue with address"])
        XCTAssertTrue(app.textFields["Amount to send"].waitForExistence(timeout: 5))
    }

    private func assertNoWrites(_ app: XCUIApplication) {
        let marker = app.staticTexts["rpc-fixture-writes"]
        XCTAssertTrue(marker.waitForExistence(timeout: 5))
        XCTAssertEqual(marker.label, "rpc-fixture-writes-0")
    }

    func testDeployedSendUpToReview() {
        let app = launch("ready")
        tap(app.buttons["Send"])
        XCTAssertTrue(app.staticTexts["Send to"].waitForExistence(timeout: 5))
        snapshot(app, "send-recipient")
        type("0x12345not-hex", into: app.textFields["Recipient address or saved name"])
        tap(app.buttons["Continue with address"])
        XCTAssertTrue(app.staticTexts["Enter a valid Starknet address."].waitForExistence(timeout: 5))
        let field = app.textFields["Recipient address or saved name"]
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + recipient)
        tap(app.buttons["Continue with address"])

        let amount = app.textFields["Amount to send"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5))
        type("0", into: amount)
        tap(app.buttons["Review send"])
        XCTAssertTrue(app.staticTexts["Enter an amount greater than zero."].waitForExistence(timeout: 5))
        tap(app.buttons["Max"])
        XCTAssertEqual(amount.value as? String, "125.5")
        snapshot(app, "send-details")
        tap(app.buttons["Review send"])

        XCTAssertTrue(app.staticTexts["Estimated fee: 0.008053 STRK"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["125.5 STRK"].exists)
        XCTAssertTrue(app.buttons["Copy recipient address"].exists)
        let confirm = app.buttons["Confirm and send"]
        XCTAssertTrue(confirm.exists && confirm.isEnabled)
        snapshot(app, "send-review")
        tap(app.buttons["Edit"])
        XCTAssertTrue(app.textFields["Amount to send"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Confirm and send"].exists, "an edit drops the review")
        assertNoWrites(app)
    }

    func testUndeployedReviewShowsBothFeesAndTheHomeNotice() {
        let app = launch("undeployed")
        XCTAssertTrue(app.buttons["Deploy account"].waitForExistence(timeout: 15), "home deploy notice")
        snapshot(app, "home-deploy-notice")
        openSendDetails(app, to: recipient)
        type("1.5", into: app.textFields["Amount to send"])
        tap(app.buttons["Review send"])
        XCTAssertTrue(app.staticTexts["Estimated transaction fee: 0.008053 STRK"].waitForExistence(timeout: 15))
        let deploymentFee = NSPredicate(format: "label BEGINSWITH %@", "Estimated account deployment fee: ")
        XCTAssertTrue(app.staticTexts.matching(deploymentFee).firstMatch.exists)
        XCTAssertTrue(app.buttons["Confirm and send"].isEnabled)
        snapshot(app, "send-review-undeployed")
        assertNoWrites(app)
    }

    func testUnfundedHomeAsksForStrk() {
        let app = launch("unfunded")
        XCTAssertTrue(app.buttons["Fund with STRK"].waitForExistence(timeout: 15))
        snapshot(app, "home-fund-notice")
    }

    func testFeeFailureAndPoisoningBlockConfirm() {
        let app = launch("feeFailure")
        openSendDetails(app, to: recipient)
        type("1", into: app.textFields["Amount to send"])
        tap(app.buttons["Review send"])
        let feeFailure = app.staticTexts[
            "Couldn't estimate the network fee right now. Check your connection and retry before sending."
        ]
        XCTAssertTrue(feeFailure.waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Retry fee estimate"].exists)
        XCTAssertTrue(app.staticTexts["Fee estimate unavailable. Retry before authorizing this transaction."].exists)
        XCTAssertFalse(app.buttons["Confirm and send"].isEnabled)
        snapshot(app, "send-review-fee-failure")
        tap(app.buttons["Back"])
        tap(app.buttons["Back"])
        let field = app.textFields["Recipient address or saved name"]
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 70) + lookalike)
        tap(app.buttons["Continue with address"])
        type("1", into: app.textFields["Amount to send"])
        tap(app.buttons["Review send"])
        let poisoned = app.staticTexts["This recipient closely mimics a saved address. Change it and review again."]
        XCTAssertTrue(poisoned.waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["Confirm and send"].isEnabled)
        snapshot(app, "send-review-poisoned")
        assertNoWrites(app)
    }
}
