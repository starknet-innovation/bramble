@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// A site's typed data signed by a Ledger account in the in-app browser, through the real core: a
/// Ledger-only wallet holding LedgerW account 0, connected to the site, and `LedgerSigner` over a
/// device replaying the Speculos transcripts (`extension-ledger.jsonl`) for the version, key and
/// path. No transcript holds a typed-data hash, so the device answers the hash with the recorded
/// transfer signature: the core checks it against the card's hash and refuses it (163). That
/// check is the point of the approved case; a verified signature is covered in wallet-core.
@MainActor
final class DappLedgerSignTests: XCTestCase {
    private static let key0 = "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"
    /// The recorded sign-hash request for the transfer the transcripts signed.
    private static let transferHashRequest =
        "5a02010020051899a4f58db1d9dd67bd2887ce37adfcbdd41c1163b49c345143e20184cdcd"
    private let origin = "https://app.example.com"
    private let id = "0f8fad5b-d9cb-469f-a165-70867728950e"
    private let ledger = LedgerDevice(id: UUID(), name: "Nano X 1A2B")

    private struct NoRpc: RpcTransport {
        func post(_: String, to _: URL, write _: Bool) throws -> String {
            throw RpcTransportFailure.unreachable
        }
    }

    private struct NoNetwork: PortfolioTransport {
        func perform(_: HttpRequest) -> HttpOutcome {
            HttpOutcome(status: 0, retryAfter: nil, body: nil, timedOut: false)
        }
    }

    private struct Rig {
        let sink: DappRequestSink
        let signer: LedgerSigner
        let device: TypedDataLedger
        let record: AccountRecord
        let requestId: UInt64
        let card: DappRequestSink.Card
    }

    func testTheSheetNamesTheReviewedAccountAndTheCoreChecksTheSignature() async throws {
        let rig = try rig()
        var shown: (LedgerSigner.Stage, AccountRecord?)?
        rig.device.onHash = { shown = (rig.signer.stage, rig.signer.account) }
        let signing = Task { await rig.sink.sign(rig.card) }
        try await until { rig.signer.stage == .scanning }
        XCTAssertEqual(rig.sink.cards.first?.id, rig.card.id, "the card stays under the Ledger sheet")
        rig.signer.choose(ledger)
        let settled = await signing.value
        guard case .confirming = shown?.0 else {
            XCTFail("the sheet showed the hash while the device asked")
            return
        }
        let account = try XCTUnwrap(shown?.1)
        XCTAssertEqual(account.id, rig.record.id)
        XCTAssertEqual(LedgerSignCopy.signer(account), "Signing with \(rig.record.shortAddress) · Account 0")
        XCTAssertEqual(settled.map(\.requestId), [rig.requestId])
        XCTAssertEqual(try code(settled), 163, "a signature over another hash never reaches the page")
        XCTAssertEqual(rig.device.hashes.count, 1)
        XCTAssertEqual(rig.signer.stage, .idle)
        XCTAssertTrue(rig.sink.cards.isEmpty)
    }

    func testARefusalOnTheDeviceParksAndTryAgainAsksForTheSameHash() async throws {
        let rig = try rig { $0.refuseFirst = true }
        let signing = Task { await rig.sink.sign(rig.card) }
        try await until { rig.signer.stage == .scanning }
        rig.signer.choose(ledger)
        try await until { if case .refused = rig.signer.stage { true } else { false } }
        XCTAssertEqual(rig.device.hashes.count, 1)
        rig.signer.retry()
        let settled = await signing.value
        XCTAssertEqual(rig.device.hashes.count, 2)
        XCTAssertEqual(rig.device.hashes.first, rig.device.hashes.last, "the same hash, asked again")
        XCTAssertEqual(settled.map(\.requestId), [rig.requestId])
    }

    func testCancellingOnTheSheetRefusesThePage() async throws {
        let rig = try rig { $0.hold = true }
        let signing = Task { await rig.sink.sign(rig.card) }
        try await until { rig.signer.stage == .scanning }
        rig.signer.choose(ledger)
        try await until { if case .confirming = rig.signer.stage { true } else { false } }
        rig.signer.cancel()
        let settled = await signing.value
        XCTAssertEqual(try code(settled), 163)
        XCTAssertTrue(rig.device.closed)
        XCTAssertEqual(rig.signer.stage, .idle)
        XCTAssertTrue(rig.sink.cards.isEmpty)
    }

    // MARK: Fixtures

    private func rig(_ configure: (TypedDataLedger) -> Void = { _ in /* Answers every request. */ }) throws -> Rig {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let core = try WalletCore(dataDir: dir.path, clock: DeviceClock())
        let candidate = try XCTUnwrap(ledgerAccountCandidates(
            network: .mainnet,
            family: .openZeppelin,
            keys: [LedgerKey(scheme: .bramble, accountIndex: 0, publicKeyX: Self.key0)]
        ).first)
        let record = try core.createLedgerWallet(password: testPassword, request: candidate.request)
        let script = try recordedLedgerExchanges(bundle: Bundle(for: Self.self))
        let hashRequest = try hexBytes(Self.transferHashRequest)
        let replay = ReplayLedgerDevice(script: script)
        let device = TypedDataLedger(replay: replay, signature: try XCTUnwrap(script[hashRequest]))
        configure(device)
        let signer = LedgerSigner(
            scanner: FakeLedgerScanner(bluetooth: .ready, devices: [ledger]),
            osGate: LedgerOsCheck.skipped
        ) { _ in device }
        let sink = DappRequestSink(core: core, rpc: NoRpc(), signer: signer, http: NoNetwork())
        guard case .held = sink.answer(request("wallet_requestAccounts"), shown: .mainnet) else {
            throw XCTSkip("expected a connect card")
        }
        _ = sink.approve(try XCTUnwrap(sink.cards.first), accountId: record.id)
        let sign = sink.answer(request("wallet_signTypedData", typedData), shown: .mainnet)
        guard case let .held(requestId) = sign else {
            throw XCTSkip("expected a sign card")
        }
        return Rig(
            sink: sink,
            signer: signer,
            device: device,
            record: record,
            requestId: requestId,
            card: try XCTUnwrap(sink.cards.first)
        )
    }

    private let typedData = #"{"typed_data":{"domain":{"chainId":"SN_MAIN","name":"Bramble Test","revision":"1","#
        + #""version":"1"},"message":{"content":"hello"},"primaryType":"Mail","types":{"Mail":[{"name":"content","#
        + #""type":"felt"}],"StarknetDomain":[{"name":"name","type":"shortstring"},{"name":"version","#
        + #""type":"shortstring"},{"name":"chainId","type":"shortstring"},{"name":"revision","type":"shortstring"}]}}}"#

    private func request(_ method: String, _ params: String? = nil) -> DappRequest {
        DappRequest(origin: origin, id: id, method: method, params: params)
    }

    private func code(_ settled: [DappRequestSink.Settled]) throws -> Int? {
        let json = try XCTUnwrap(settled.first).json
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        return (object["error"] as? [String: Any])?["code"] as? Int
    }
}

/// The recorded device, except the sign-hash request: answered with `signature`, refused once
/// (`refuseFirst`), or held until the link closes (`hold`, a device waiting on the person).
@MainActor
final class TypedDataLedger: LedgerExchanging {
    let replay: ReplayLedgerDevice
    let signature: Data
    /// The Starknet app's refusal of a sign (rejected, or Blind signing off).
    private static let refusedWord = (try? hexBytes("6985")) ?? Data()
    var refuseFirst = false
    var hold = false
    /// Sees the moment the hash is asked for.
    var onHash: (() -> Void)?
    private(set) var hashes: [Data] = []
    private(set) var closed = false
    private var waiting: CheckedContinuation<Void, Never>?

    init(replay: ReplayLedgerDevice, signature: Data) {
        self.replay = replay
        self.signature = signature
    }

    func send(_ apdu: Data) async -> LedgerExchange {
        guard LedgerSigner.shownHash(apdu) != nil else { return replay.send(apdu) }
        hashes.append(apdu)
        onHash?()
        if hold {
            await withCheckedContinuation { waiting = $0 }
            return .failure(.disconnected)
        }
        if refuseFirst, hashes.count == 1 { return .reply(Self.refusedWord) }
        return .reply(signature)
    }

    func close() {
        closed = true
        replay.close()
        waiting?.resume()
        waiting = nil
    }
}
