@testable import Bramble
import BrambleCore
import XCTest

/// Exercises the Rust core through the generated Swift bindings on a simulator: the same parity
/// fixture the Rust suite uses, so a binding or linking fault shows up as a wrong address here.
final class CoreBridgeTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Account: Decodable {
            let accountIndex: UInt32
            let address: String
            let networkId: String
            let publicKeyX: String
            let signatureR: String
            let signatureS: String
        }

        let accounts: [Account]
        let messageHash: String
        let mnemonic: String
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "extension-parity", withExtension: "json"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func core() throws -> WalletCore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return try WalletCore(dataDir: dir.path, clock: DeviceClock())
    }

    func testParityWithTheExtension() throws {
        let fixture = try fixture()
        let core = try core()
        try core.importWallet(password: "parity password", phrase: fixture.mnemonic, passphrase: nil)
        // An import waits for discovery; restore OZ 0 and 1, then project index 0 onto Mainnet.
        let restored = try core.restoreRecoveredAccounts(network: .sepolia, selections: [0, 1].map { index in
            RecoverySelection(family: .openZeppelin, accountIndex: index, classHash: nil)
        })
        try core.selectAccount(accountId: restored[0].id)
        _ = try core.ensureNetworkAccount(network: .mainnet)
        for vector in fixture.accounts {
            let network: NetworkId = vector.networkId == "SN_MAIN" ? .mainnet : .sepolia
            let account = try XCTUnwrap(
                try core.accountRecords(network: network).first { $0.accountIndex == vector.accountIndex }
            )
            XCTAssertEqual(account.address, vector.address)
            XCTAssertEqual(account.publicKey, vector.publicKeyX)
            // Signing is by account record, never by index (docs/accounts.md §2.7).
            let signature = try core.signHashForAccount(accountId: account.id, messageHash: fixture.messageHash)
            XCTAssertEqual(signature.r, vector.signatureR)
            XCTAssertEqual(signature.s, vector.signatureS)
        }
    }

    /// The extension's meter vectors through FFI, and the setup form's one gate: past the
    /// 8-character floor a matched passphrase submits, weak or not (no acknowledgement).
    func testPassphraseMeterAndGateFollowTheExtension() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "extension-parity", withExtension: "json"))
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let rendered: [String: Any] = try fixtureValue(fixture, "ui")
        let vectors: [[String: Any]] = try fixtureValue(rendered, "passphrases")
        XCTAssertFalse(vectors.isEmpty)
        let levels: [String: PassphraseLevel] = ["empty": .empty, "weak": .weak, "fair": .fair, "strong": .strong]
        for vector in vectors {
            let value: String = try fixtureValue(vector, "value")
            let strength = passphraseStrength(passphrase: value)
            let acceptable = vector["acceptable"] as? Bool
            XCTAssertEqual(strength.acceptable, acceptable, value)
            XCTAssertEqual(strength.hint, vector["hint"] as? String, value)
            XCTAssertEqual(strength.level, levels[vector["level"] as? String ?? ""], value)
            let submits = PassphraseStep.canSubmit(strength, passphrase: value, confirmation: value)
            XCTAssertEqual(submits, acceptable, value)
            XCTAssertFalse(PassphraseStep.canSubmit(strength, passphrase: value, confirmation: value + "x"), value)
        }
        let weak = passphraseStrength(passphrase: "aaaaaaaa")
        XCTAssertEqual(weak.level, .weak)
        XCTAssertTrue(PassphraseStep.canSubmit(weak, passphrase: "aaaaaaaa", confirmation: "aaaaaaaa"))
    }

    func testLockedCoreRefusesKeyOperations() throws {
        let core = try core()
        let phrase = try core.createWallet(password: "a strong password", wordCount: 12)
        XCTAssertEqual(phrase.words.count, 12)
        let id = try XCTUnwrap(try core.activeAccount()).id
        core.lock()
        XCTAssertEqual(core.status(), .locked)
        XCTAssertThrowsError(try core.signHashForAccount(accountId: id, messageHash: "0x1")) { error in
            guard case .Locked = error as? CoreError else { return XCTFail("expected Locked, got \(error)") }
        }
        XCTAssertThrowsError(try core.unlock(password: "wrong password")) { error in
            guard case .WrongPassword = error as? CoreError else {
                return XCTFail("expected WrongPassword, got \(error)")
            }
        }
    }

    func testBundledNetworksComeFromTheExtensionCatalog() {
        let sepolia = supportedNetworks().first { $0.network == .sepolia }
        XCTAssertEqual(sepolia?.chainId, "0x534e5f5345504f4c4941")
        XCTAssertTrue(sepolia?.tokens.contains { $0.symbol == "STRK" } ?? false)
    }
}
