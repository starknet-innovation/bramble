@testable import Bramble
import BrambleCore
import XCTest

/// Send's recipient stage against the extension (`recipientStage`, `bindRecipientControls`, and the
/// rendered `send-recipient-stage` in `extension-transactions-copy.json`): the address book, the
/// user's accounts under their folders (name and count, empty folders not listed, the sender
/// marked "Current"), search, the name a typed address reads under, and when Save is offered.
final class SendRecipientsTests: XCTestCase {
    private func stage() throws -> (text: [String], ariaLabels: [String]) {
        let copy: [String: Any] = try fixtureValue(transactionFixture(), "copy")
        let screens: [String: Any] = try fixtureValue(copy, "screens")
        let sections: [String: Any] = try fixtureValue(screens, "sections")
        let recipient: [String: Any] = try fixtureValue(sections, "send-recipient-stage")
        return (try fixtureValue(recipient, "text"), try fixtureValue(recipient, "ariaLabels"))
    }

    private func contact(_ label: String, _ address: String) -> Contact {
        Contact(id: label, label: label, network: .sepolia, address: address, publicKeyX: nil, nostrPublicKey: nil)
    }

    func testTheStageReadsTheExtensionsWords() throws {
        let (text, ariaLabels) = try stage()
        // Send from, name, address, Send to, Address book, Save, My accounts, 1, name, address,
        // Current, No matching recipient., Continue with address.
        XCTAssertEqual(text.count, 13)
        XCTAssertEqual(
            [text[0], text[3], text[4], text[5], text[11], text[12]],
            [
                SendCopy.sendFrom, SendCopy.sendTo, SendCopy.addressBook, SendCopy.saveRecipient,
                SendCopy.noMatchingRecipient, SendCopy.continueWithAddress
            ]
        )
        XCTAssertEqual(ariaLabels, [SendCopy.copySendingAddress, SendCopy.recipientFieldLabel])
        // The one-account wallet the extension rendered: its folder heading, count and Current.
        let core = try unlockedCore()
        let sender = try ozRecord(core, .sepolia)
        let folders = SendRecipients.folders(groups: [], accounts: [sender], senderId: sender.id)
        XCTAssertEqual(folders.map(\.name), [text[6]])
        XCTAssertEqual(folders.map { String($0.rows.count) }, [text[7]])
        XCTAssertEqual(folders.first?.rows.map(\.current), [true])
        XCTAssertEqual(SendCopy.currentAccount, text[10])
    }

    func testAccountsSitUnderTheirFoldersAndEmptyFoldersDropOut() throws {
        let core = try unlockedCore()
        let first = try ozRecord(core, .sepolia)
        let second = try ozRecord(core, .sepolia, 1)
        let savings = AccountGroup(id: "savings", name: "Savings", icon: "piggyBank", accountIds: [second.id])
        let travel = AccountGroup(id: "travel", name: "Travel", icon: "briefcase", accountIds: [])
        let folders = SendRecipients.folders(
            groups: [savings, travel],
            accounts: [first, second],
            senderId: first.id
        )
        XCTAssertEqual(folders.map(\.name), [SendCopy.myAccounts, "Savings"], "an empty folder is not listed")
        XCTAssertEqual(folders.map(\.icon), [SendRecipients.homeFolderIcon, "piggyBank"])
        XCTAssertEqual(folders.map { $0.rows.map(\.address) }, [[first.address], [second.address]])
        XCTAssertEqual(folders.flatMap(\.rows).map(\.current), [true, false], "the sender stays pickable")
        // A folder the user named like the synthesised home folder never swallows unfiled accounts.
        let home = AccountGroup(id: "home", name: "Home", icon: "home", accountIds: [second.id])
        let named = SendRecipients.folders(groups: [home], accounts: [first, second], senderId: first.id)
        XCTAssertEqual(named.map { $0.rows.map(\.address) }, [[first.address], [second.address]])
    }

    func testSearchFiltersEveryListAndDropsEmptyFolders() throws {
        let core = try unlockedCore()
        let first = try ozRecord(core, .sepolia)
        let second = try ozRecord(core, .sepolia, 1)
        let savings = AccountGroup(id: "savings", name: "Savings", icon: "piggyBank", accountIds: [second.id])
        let folders = SendRecipients.folders(groups: [savings], accounts: [first, second], senderId: first.id)
        XCTAssertEqual(SendRecipients.matching(folders, query: "  "), folders, "no query shows every folder")
        let query = String(second.address.suffix(6)).uppercased()
        XCTAssertEqual(SendRecipients.matching(folders, query: query).map(\.name), ["Savings"])
        XCTAssertTrue(SendRecipients.matching(folders, query: "no such recipient").isEmpty)
        let contacts = SendRecipients.contacts([contact("Alice", account1)])
        XCTAssertEqual(SendRecipients.matching(contacts, query: "ALI").map(\.name), ["Alice"])
        XCTAssertTrue(SendRecipients.matching(contacts, query: "bob").isEmpty)
        XCTAssertEqual(contacts.first?.short, shortAddress(account1))
    }

    func testATypedAddressReadsAsItsRowAndSaveIsOfferedOnlyForANewOne() throws {
        let core = try unlockedCore()
        let first = try ozRecord(core, .sepolia)
        let rows = SendRecipients.contacts([contact("Alice", account1)])
            + SendRecipients.folders(groups: [], accounts: [first], senderId: first.id).flatMap(\.rows)
        // Compared as felts: a zero-padded spelling of a saved address is still that contact.
        let padded = "0x0" + account1.dropFirst(2)
        XCTAssertEqual(SendRecipients.knownLabel(of: padded, in: rows), "Alice")
        XCTAssertEqual(SendRecipients.knownLabel(of: first.address, in: rows), first.displayName)
        XCTAssertNil(SendRecipients.knownLabel(of: "0x1234", in: rows))
        XCTAssertTrue(SendRecipients.offersSave(typed: "0x1234", rows: rows), "a new, valid address")
        XCTAssertFalse(SendRecipients.offersSave(typed: padded, rows: rows), "already saved")
        XCTAssertFalse(SendRecipients.offersSave(typed: first.address, rows: rows), "one of the user's accounts")
        XCTAssertFalse(SendRecipients.offersSave(typed: "not an address", rows: rows))
    }
}
