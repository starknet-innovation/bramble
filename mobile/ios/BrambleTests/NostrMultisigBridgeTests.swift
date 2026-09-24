import BrambleCore
import XCTest

/// Nostr identity, wallet cards, relay URLs, the Argent multisig layout, and the sans-IO relay and
/// chain judges, through the generated Swift bindings and against the same extension-made fixture
/// the Rust suite reads (`nostr-multisig-parity.json`). No test touches the network.
final class NostrMultisigBridgeTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "nostr-multisig-parity", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func wallet(_ phrase: String) throws -> WalletCore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let core = try WalletCore(dataDir: dir.path)
        try core.importWallet(password: "parity password", phrase: phrase, passphrase: nil)
        return core
    }

    func testCoordinationKeysMatchTheExtension() throws {
        // Address 1 is the parity suites' co-signer identity; a wallet holds address 0 only.
        let keys = try XCTUnwrap(try fixture()["nostrKeys"] as? [[String: Any]]).filter { $0["index"] as? Int == 0 }
        XCTAssertFalse(keys.isEmpty)
        for vector in keys {
            let core = try wallet(try XCTUnwrap(vector["mnemonic"] as? String))
            XCTAssertEqual(try core.nostrPublicKey(), vector["publicKey"] as? String)
            core.lock()
            XCTAssertThrowsError(try core.nostrPublicKey()) { XCTAssertEqual($0 as? CoreError, .Locked) }
        }
    }

    func testMultisigAddressesMatchTheExtension() throws {
        let argent = try XCTUnwrap(try fixture()["argent"] as? [String: Any])
        for vector in try XCTUnwrap(argent["configs"] as? [[String: Any]]) {
            let config = ArgentMultisigConfig(threshold: try XCTUnwrap(vector["threshold"] as? UInt32),
                                              signerPublicKeys: try XCTUnwrap(vector["signerPublicKeys"] as? [String]))
            let prediction = try argentMultisigPredict(config: config, salt: try XCTUnwrap(vector["salt"] as? String))
            XCTAssertEqual(prediction.address, vector["address"] as? String)
            XCTAssertEqual(prediction.constructorCalldata, vector["calldata"] as? [String])
        }
        XCTAssertThrowsError(try argentMultisigNormalize(config: ArgentMultisigConfig(threshold: 2, signerPublicKeys: ["0x1"])))
    }

    func testWalletCardsRoundTripAndKnowTheirNetwork() throws {
        let card = WalletContactCard(network: .sepolia, address: "0x123", publicKeyX: "0x456", nostrPublicKey: String(repeating: "11", count: 32))
        let encoded = try walletContactCardEncode(card: card)
        XCTAssertTrue(encoded.hasPrefix("mcw:contact:1:SN_SEPOLIA:"))
        guard case .valid(let parsed) = walletContactCardParse(text: encoded, network: .sepolia) else {
            return XCTFail("a valid card parses")
        }
        XCTAssertEqual(parsed.address, "0x" + String(repeating: "0", count: 61) + "123")
        guard case .otherNetwork = walletContactCardParse(text: encoded, network: .mainnet) else {
            return XCTFail("another network's card is named as such")
        }
        guard case .unrecognized = walletContactCardParse(text: "mcw:contact:2:x", network: .mainnet) else {
            return XCTFail("garbage is unrecognised")
        }
        XCTAssertEqual(shortKey(value: "0x0123456789abcdef"), "0x0123…cdef")
    }

    func testRelayUrlsAreSecureOnly() throws {
        XCTAssertNil(try nostrRelayUrlNormalize(raw: "  "))
        XCTAssertEqual(try nostrRelayUrlNormalize(raw: " wss://relay.example "), "wss://relay.example")
        XCTAssertThrowsError(try nostrRelayUrlNormalize(raw: "ws://localhost:7000"))
        XCTAssertThrowsError(try nostrRelayUrlNormalize(raw: "https://relay.example"))
    }

    /// A scripted relay: an oversized frame is ignored, the wrap is kept, EOSE closes the socket.
    func testSyncPlanJudgesFramesAndFinishesWithoutTheNetwork() throws {
        let fixture = try fixture()
        let core = try wallet(try XCTUnwrap((fixture["nostrKeys"] as? [[String: Any]])?.first?["mnemonic"] as? String))
        let config = ArgentMultisigConfig(threshold: 1, signerPublicKeys: [try core.accounts(network: .sepolia)[0].publicKey])
        let record = try core.saveMultisigSetup(network: .sepolia, name: "Team", config: config, salt: "0x0", deployerAccountIndex: 0)
        let plan = try core.coordinationSyncBegin(multisigId: record.id, now: 1_750_000_000)
        XCTAssertEqual(plan.relayUrls(), try core.relayPolicy().relayUrls)
        XCTAssertTrue(plan.openFrame(relay: 0).hasPrefix(##"["REQ","mcw-1",{"#p":["##))
        let oversized = #"["NOTICE",""# + String(repeating: "x", count: 140_001) + #""]"#
        XCTAssertEqual(plan.acceptFrame(relay: 0, frame: oversized), .continue)
        guard case .finish(let close) = plan.acceptFrame(relay: 0, frame: #"["EOSE","mcw-1"]"#) else {
            return XCTFail("EOSE finishes the relay")
        }
        XCTAssertEqual(close, #"["CLOSE","mcw-1"]"#)
        plan.relayEnded(relay: 1)
        let outcome = try core.coordinationSyncFinish(plan: plan)
        XCTAssertEqual(outcome.received, 0)
        XCTAssertEqual(outcome.imported, 0)

        let silent = try core.coordinationSyncBegin(multisigId: record.id, now: 1_750_000_100)
        silent.relayEnded(relay: 0)
        silent.relayEnded(relay: 1)
        XCTAssertThrowsError(try core.coordinationSyncFinish(plan: silent)) {
            guard case .Coordination = $0 as? CoreError else { return XCTFail("every relay failing is unavailable") }
        }
    }

    /// An authority read over recorded bodies: chain id, pin, class, threshold, GUIDs.
    func testAuthorityReadOverRecordedBodies() throws {
        let core = try wallet("habit hope tip crystal because grunt nation idea electric witness alert like")
        let key = try core.accounts(network: .sepolia)[0].publicKey
        let guid = try argentSignerGuid(publicKey: key)
        let read = try MultisigAuthorityRead(network: .sepolia, address: "0x123")
        let answers: [String] = [
            #""0x534e5f5345504f4c4941""#, #"{"block_hash":"0xabc","block_number":1}"#,
            #""0x07aeca3456816e3b833506d7cc5c1313d371fbdb0ae95ee70af72a4ddbf42594""#, #"["0x1"]"#,
            #"["0x1",""# + guid + #""]"#,
        ]
        for answer in answers {
            let request = try XCTUnwrap(read.nextRequest())
            try read.acceptResponse(id: request.id, body: #"{"jsonrpc":"2.0","id":\#(request.id),"result":\#(answer)}"#)
        }
        XCTAssertEqual(read.status(), .available)
        let record = try core.addMultisig(read: read)
        XCTAssertTrue(record.hasCurrentConfig)
        XCTAssertEqual(record.localSignerIndexes, [0])
        XCTAssertEqual(try core.multisigs(network: .sepolia).map(\.id), ["SN_SEPOLIA:0x123"])
    }
}
