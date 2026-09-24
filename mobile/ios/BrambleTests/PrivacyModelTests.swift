import BrambleCore
import XCTest

/// `PrivacyModel` and the transport around the core's read plan: scope guards, lock, Sepolia,
/// failures, and that no viewing key is ever visible to Swift state.
@MainActor
final class PrivacyModelTests: XCTestCase {
    private func script(_ id: String) throws -> [String: Any] {
        let wire = try privacyFixture("wire", rows: ["cases"])
        let cases = try XCTUnwrap(wire["cases"] as? [[String: Any]])
        return try XCTUnwrap(cases.first { $0["id"] as? String == id }?["script"] as? [String: Any])
    }

    func testSepoliaSettlesUnconfiguredWithoutAPlan() async throws {
        let service = ScriptedPrivacyService(script: [:])
        let model = PrivacyModel()
        let sepolia = supportedNetworks().first { $0.network == .sepolia }!
        await model.refresh(core: try unlockedCore(), network: sepolia, accountIndex: 0, rpc: service, transports: (service, service))
        XCTAssertEqual(model.reading, .unconfigured)
        XCTAssertTrue(service.bodies.isEmpty)
    }

    func testAFailedReadIsUnavailableAndAResetDropsState() async throws {
        let service = ScriptedPrivacyService(script: try script("server-500"))
        let model = PrivacyModel()
        await model.refresh(core: try unlockedCore(), network: mainnet(), accountIndex: 0, rpc: service, transports: (service, service))
        XCTAssertEqual(model.reading, .failed)
        XCTAssertEqual(privacyStatus(network: .mainnet, reading: model.reading), .unavailable)
        model.reset()
        XCTAssertEqual(model.reading, .idle)
        XCTAssertNil(model.state)
    }

    func testALockedCoreNeverStartsARead() async throws {
        let core = try unlockedCore()
        core.lock()
        let service = ScriptedPrivacyService(script: try script("one-token"))
        let model = PrivacyModel()
        await model.refresh(core: core, network: mainnet(), accountIndex: 0, rpc: service, transports: (service, service))
        XCTAssertEqual(model.reading, .failed)
        XCTAssertTrue(service.bodies.isEmpty)
    }

    func testSwiftStateNeverHoldsTheViewingKey() async throws {
        let wire = try privacyFixture("wire", rows: [])
        let keys = try XCTUnwrap(wire["viewingKeys"] as? [String: Any])
        let account0 = try XCTUnwrap((keys["accounts"] as? [[String: Any]])?.first?["viewingKey"] as? String)
        let service = ScriptedPrivacyService(script: try script("one-token"))
        let model = PrivacyModel()
        await model.refresh(core: try unlockedCore(), network: mainnet(), accountIndex: 0, rpc: service, transports: (service, service))
        let observable = "\(model.reading) \(String(describing: model.state))"
        XCTAssertFalse(observable.contains(String(account0.dropFirst(2))))
        // It does leave inside the opaque discovery bodies, as the extension's fetch sends it.
        XCTAssertTrue(service.bodies.contains { String(decoding: $0.1, as: UTF8.self).contains(account0) })
    }

    func testTheDriverWipesTheStorageABodySharesWithItsStep() {
        let original = Data(repeating: 0x37, count: 96)
        let handedOver = original
        PrivacyDriver.wipe(handedOver)
        XCTAssertTrue(original.allSatisfy { $0 == 0 })
    }

    func testASwitchedScopeForgetsTheReadingBeforeTheNextRead() async throws {
        let service = ScriptedPrivacyService(script: try script("one-token"))
        let model = PrivacyModel()
        await model.refresh(core: try unlockedCore(), network: mainnet(), accountIndex: 0, rpc: service, transports: (service, service))
        XCTAssertNotNil(model.state)
        model.retain(network: .mainnet, accountIndex: 0)
        XCTAssertNotNil(model.state, "the same scope keeps its reading while it refreshes")
        model.retain(network: .sepolia, accountIndex: 0)
        XCTAssertNil(model.state)
        XCTAssertEqual(model.reading, .idle)
    }

    func testThePrivacyTransportRefusesCleartext() async {
        do {
            _ = try await URLSessionPrivacyTransport().post(Data(), to: URL(string: "http://example.invalid")!)
            XCTFail("cleartext accepted")
        } catch {
            XCTAssertEqual(error as? PrivacyTransportFailure, .notHttps)
        }
    }
}
