import XCTest

/// Drives the wallet card, contacts, relay settings, shared accounts, and co-signer updates on a
/// fresh install with the public parity phrase on Sepolia. `-BrambleStubNetwork` and
/// `-BrambleStubRelay` (DEBUG only) swap in recorded multisig RPC answers and a scripted relay, so
/// no multisig read or relay socket reaches the network. The relay delivers the gift wrap in
/// `ui-coordination.json`, which the Rust suite writes and verifies (`ui_coordination_fixture.rs`).
/// `-BrambleUITestReset` (DEBUG only, `UITestHooks`) empties the app's vault directory at launch, so every run
/// starts from onboarding whether or not an earlier run left a wallet installed.
final class NostrMultisigFlowTests: XCTestCase {
    private let phrase = "habit hope tip crystal because grunt nation idea electric witness alert like"
    private let passphrase = "ui test passphrase"

    private struct Fixture: Decodable {
        let cosignerCardMainnet: String
        let cosignerCardSepolia: String
        let predictedAddress: String
        let relayEvents: [String]
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ui-coordination", withExtension: "json"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func short(_ value: String) -> String { "\(value.prefix(6))…\(value.suffix(4))" }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 15), "\(element) exists")
        let enabled = expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: element)
        wait(for: [enabled], timeout: 20)
        for _ in 0..<4 where !element.isHittable { app.swipeUp() }
        element.tap()
    }

    /// Taps the app's own button when the keyboard offers a key with the same label.
    private func tapOutsideKeyboard(_ label: String, in app: XCUIApplication) {
        let matches = app.buttons.matching(identifier: label)
        XCTAssertTrue(matches.firstMatch.waitForExistence(timeout: 10), "\(label) exists")
        let keyboard = app.keyboards.firstMatch
        let own = (0..<matches.count).map { matches.element(boundBy: $0) }
            .first { !keyboard.exists || !keyboard.frame.intersects($0.frame) }
        (own ?? matches.firstMatch).tap()
    }

    /// A text field or, for multi-line fields, a text view with this accessibility label.
    private func input(_ label: String, in app: XCUIApplication) -> XCUIElement {
        let field = app.textFields[label]
        return field.waitForExistence(timeout: 3) ? field : app.textViews[label]
    }

    private func replace(_ label: String, with text: String, in app: XCUIApplication) {
        let field = input(label, in: app)
        tap(field, in: app)
        let current = (field.value as? String) ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2) + text)
    }

    private func expect(_ text: String, in app: XCUIApplication, timeout: TimeInterval = 15) {
        XCTAssertTrue(app.staticTexts[text].firstMatch.waitForExistence(timeout: timeout), "\"\(text)\" shown")
    }

    private func launchAndImport(_ fixture: Fixture) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-network", "sepolia", "-BrambleUITestReset", "-BrambleStubNetwork", "YES", "-BrambleStubRelay", "YES"
        ]
        let events = try XCTUnwrap(String(bytes: try JSONEncoder().encode(fixture.relayEvents), encoding: .utf8))
        app.launchEnvironment = ["BRAMBLE_STUB_RELAY_EVENTS": events]
        app.launch()
        XCTAssertTrue(app.buttons["Add an existing wallet"].waitForExistence(timeout: 10), "onboarding shown")
        tap(app.buttons["Add an existing wallet"], in: app)
        tap(app.buttons["Recovery phrase"], in: app)
        for (index, word) in phrase.split(separator: " ").enumerated() {
            let field = app.textFields["Word \(index + 1)"]
            tap(field, in: app)
            field.typeText(String(word))
        }
        tapOutsideKeyboard("Continue", in: app)
        tap(app.secureTextFields["Vault passphrase"], in: app)
        app.secureTextFields["Vault passphrase"].typeText(passphrase)
        tap(app.secureTextFields["Confirm passphrase"], in: app)
        app.secureTextFields["Confirm passphrase"].typeText(passphrase)
        tap(app.buttons["Find your accounts"], in: app)
        tap(app.buttons["Add selected account"], in: app)
        tap(app.buttons["Open Bramble"], in: app)
        XCTAssertTrue(app.staticTexts["Account 1"].waitForExistence(timeout: 20))
        return app
    }

    func testCardContactsRelayAndSharedAccounts() throws {
        let fixture = try fixture()
        let app = try launchAndImport(fixture)
        receiveCard(app)
        relaySettings(app)
        addressBook(app, fixture)
        createMultisig(app, fixture)
        savedSetupUpdates(app, fixture)
        addByAddress(app, fixture)
    }

    /// Receive: the address first, then the card once the coordination key is derived.
    private func receiveCard(_ app: XCUIApplication) {
        tap(app.buttons["Receive"], in: app)
        XCTAssertTrue(app.buttons["Address"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.images["QR code for your Starknet address"].exists)
        let copyCard = app.buttons["Copy wallet card"]
        XCTAssertTrue(copyCard.waitForExistence(timeout: 15), "the card is prepared")
        tap(app.buttons["Bramble contact card"], in: app)
        XCTAssertTrue(app.images["QR code for wallet contact card"].waitForExistence(timeout: 5))
        tap(copyCard, in: app)
        // The runner may not read the app's local-only pasteboard; the control confirms the copy.
        XCTAssertTrue(app.buttons["Copied"].waitForExistence(timeout: 5), "the card was copied")
        tap(app.buttons["Wallet identity"], in: app)
        expect("Signer public key", in: app)
        XCTAssertTrue(app.buttons["Copy coordination public key"].waitForExistence(timeout: 10))
        snapshot(app, "receive-card")
        tap(app.buttons["Back"].firstMatch, in: app)
    }

    /// Relay settings: ws refused on mobile, a wss relay saved, then the defaults restored.
    private func relaySettings(_ app: XCUIApplication) {
        tap(app.buttons["Settings"], in: app)
        tap(app.buttons["Network"], in: app)
        tap(app.buttons["Multisig coordination relay"], in: app)
        replace("Custom Nostr relay", with: "ws://localhost:7000", in: app)
        tap(app.buttons["Save coordination relay"], in: app)
        expect("Mobile connects to secure relays only (wss://).", in: app)
        replace("Custom Nostr relay", with: "not a url", in: app)
        tap(app.buttons["Save coordination relay"], in: app)
        expect("Invalid Nostr relay endpoint", in: app)
        replace("Custom Nostr relay", with: "wss://relay.team.example", in: app)
        tap(app.buttons["Save coordination relay"], in: app)
        expect("Coordination relay saved", in: app)
        replace("Custom Nostr relay", with: "", in: app)
        tap(app.buttons["Save coordination relay"], in: app)
        expect("Coordination relay reset", in: app)
        snapshot(app, "relay-settings")
        tap(app.buttons["Back"].firstMatch, in: app)
    }

    /// Address book: another network's card is refused; a Sepolia card verifies and saves.
    private func addressBook(_ app: XCUIApplication, _ fixture: Fixture) {
        tap(app.buttons["Address book"], in: app)
        replace("Wallet card (optional)", with: fixture.cosignerCardMainnet, in: app)
        expect("This wallet card belongs to a different network.", in: app)
        replace("Wallet card (optional)", with: fixture.cosignerCardSepolia, in: app)
        expect("Wallet card verified. Add a label, then save.", in: app)
        replace("Label", with: "Bob", in: app)
        tap(app.buttons["Save address"], in: app)
        expect("Address saved", in: app)
        expect("Secure coordination ready", in: app)
        snapshot(app, "address-book")
        tap(app.buttons["Back"].firstMatch, in: app)
    }

    /// Create a 2-of-2 with the co-signer's wallet card; Fund shows the predicted address.
    private func createMultisig(_ app: XCUIApplication, _ fixture: Fixture) {
        tap(app.buttons["Shared accounts"], in: app)
        expect("No shared accounts are saved on this network yet.", in: app)
        tap(app.buttons["Create a multisig"], in: app)
        expect("1 signer", in: app)
        tap(app.buttons["Add participant"], in: app)
        tap(app.buttons["Wallet card"], in: app)
        replace("Participant name", with: "Bob", in: app)
        replace("Shared wallet card", with: fixture.cosignerCardSepolia, in: app)
        tap(app.buttons["Add participant"], in: app)
        expect("2 signers", in: app)
        tap(app.buttons["Continue to approval"], in: app)
        replace("Signatures required", with: "2", in: app)
        tap(app.buttons["Review deployment"], in: app)
        expect("Fund this multisig", in: app)
        expect(short(fixture.predictedAddress), in: app)
        snapshot(app, "fund")
        tap(app.buttons["Check funding"], in: app)
        expect("Balance: 0 STRK", in: app)
        tap(app.buttons["Continue to deploy"], in: app)
        XCTAssertTrue(app.buttons["Deploy multisig"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Deploy multisig"].isEnabled)
        expect(
            "Deployment from mobile arrives with sending. Deploy this saved setup from Bramble for browser, "
                + "or come back after the update.",
            in: app
        )
        tap(app.buttons["Back"].firstMatch, in: app)
    }

    /// The saved setup is listed; its co-signer's gift wrap arrives as one held update.
    private func savedSetupUpdates(_ app: XCUIApplication, _ fixture: Fixture) {
        let row = app.buttons[short(fixture.predictedAddress)]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertEqual(row.value as? String, "2 of 2 signers")
        tap(row, in: app)
        tap(app.buttons["Intents"], in: app)
        tap(app.buttons["Check for updates"], in: app)
        expect("1 co-signer update received. Open them after the next Bramble update.", in: app, timeout: 30)
        snapshot(app, "co-signer-updates")
        tap(app.buttons["Deploy"], in: app)
        expect("Complete multisig setup", in: app)
        tap(app.buttons["Back"].firstMatch, in: app)
        tap(app.buttons["Back"].firstMatch, in: app)
    }

    /// Add by address: a deployed 1-of-1 syncs; another class is refused with the extension's copy.
    /// "Multisigs" then opens the same list.
    private func addByAddress(_ app: XCUIApplication, _ fixture: Fixture) {
        tap(app.buttons["Add shared account"], in: app)
        replace("Multisig address", with: "0x123", in: app)
        tap(app.buttons["Add shared account"], in: app)
        expect("Multisig synced · 1 wallet signer found", in: app)
        replace("Multisig address", with: "0x456", in: app)
        tap(app.buttons["Add shared account"], in: app)
        expect("This address is not the pinned Argent Multisig 0.2 account", in: app)
        tap(app.buttons["Back"].firstMatch, in: app)
        tap(app.buttons["Back"].firstMatch, in: app)

        // Reachability: "Multisigs" opens the same list.
        tap(app.buttons["Multisigs"], in: app)
        expect("Shared accounts", in: app)
        XCTAssertTrue(app.buttons[short(fixture.predictedAddress)].waitForExistence(timeout: 10))
    }
}
