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
        return try WalletCore(dataDir: dir.path)
    }

    func testParityWithTheExtension() throws {
        let fixture = try fixture()
        let core = try core()
        try core.importWallet(password: "parity password", phrase: fixture.mnemonic, passphrase: nil)
        _ = try core.addAccount(network: .sepolia)
        for vector in fixture.accounts {
            let network: NetworkId = vector.networkId == "SN_MAIN" ? .mainnet : .sepolia
            let account = try core.accounts(network: network)[Int(vector.accountIndex)]
            XCTAssertEqual(account.address, vector.address)
            XCTAssertEqual(account.publicKey, vector.publicKeyX)
            let signature = try core.signHash(accountIndex: vector.accountIndex, messageHash: fixture.messageHash)
            XCTAssertEqual(signature.r, vector.signatureR)
            XCTAssertEqual(signature.s, vector.signatureS)
        }
    }

    func testLockedCoreRefusesKeyOperations() throws {
        let core = try core()
        let phrase = try core.createWallet(password: "a strong password", wordCount: 12)
        XCTAssertEqual(phrase.words.count, 12)
        core.lock()
        XCTAssertEqual(core.status(), .locked)
        XCTAssertThrowsError(try core.signHash(accountIndex: 0, messageHash: "0x1")) { error in
            guard case .Locked = error as? CoreError else { return XCTFail("expected Locked, got \(error)") }
        }
        XCTAssertThrowsError(try core.unlock(password: "wrong password")) { error in
            guard case .WrongPassword = error as? CoreError else { return XCTFail("expected WrongPassword, got \(error)") }
        }
    }

    func testBundledNetworksComeFromTheExtensionCatalog() {
        let sepolia = supportedNetworks().first { $0.network == .sepolia }
        XCTAssertEqual(sepolia?.chainId, "0x534e5f5345504f4c4941")
        XCTAssertTrue(sepolia?.tokens.contains { $0.symbol == "STRK" } ?? false)
    }
}
