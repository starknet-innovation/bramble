@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// The Ledger connect-and-pick model over a fake scanner and a device that answers each APDU with
/// its reply from the Speculos transcripts (`extension-ledger.jsonl`), through the real core
/// reader and address placement. Pages are one key, so the two recorded `LedgerW` keys make two.
@MainActor
final class LedgerConnectModelTests: XCTestCase {
    private let ledger = LedgerDevice(id: UUID(), name: "Nano X 1A2B")

    func testKeysAreReadAndPlacedAsCandidates() async throws {
        let picked = try picker()
        let model = picked.model
        let device = picked.device

        await model.choose(ledger)
        XCTAssertEqual(model.stage, .picking)
        let first = try XCTUnwrap(model.candidates.first)
        XCTAssertEqual(model.candidates.count, 1)
        XCTAssertEqual(first.request.scheme, .bramble)
        XCTAssertEqual(first.request.family, .openZeppelin)
        XCTAssertEqual(first.request.accountIndex, 0)
        XCTAssertEqual(first.request.publicKeyX, "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d")
        let placed = try ledgerAccountCandidates(network: .mainnet, family: .openZeppelin, keys: [
            LedgerKey(scheme: .bramble, accountIndex: 0, publicKeyX: first.request.publicKeyX)
        ])
        XCTAssertEqual(first.address, placed.first?.address)
        XCTAssertFalse(device.closed)
        XCTAssertTrue(model.chosen.isEmpty)
        model.toggle(first)
        XCTAssertEqual(model.chosen, [first.request])
    }

    func testShowMoreReadsTheNextPage() async throws {
        let picked = try picker()
        let model = picked.model

        await model.choose(ledger)
        await model.more()
        XCTAssertEqual(model.stage, .picking)
        XCTAssertEqual(model.candidates.map(\.request.accountIndex), [0, 1])
        XCTAssertFalse(model.loadingMore)
    }

    func testAnAppBelowTheMinimumIsRefusedWithItsMessage() async throws {
        let picked = try picker()
        let model = picked.model
        let device = picked.device

        device.version = try Self.bytes("0203099000")
        await model.choose(ledger)
        XCTAssertEqual(model.stage, .failed(try Self.message("app-below-minimum")))
        XCTAssertTrue(model.candidates.isEmpty)
        XCTAssertTrue(device.closed)
    }

    func testAWrongAppOrALockedDeviceIsRefused() async throws {
        for (status, code) in [("6d00", "no-app-open"), ("6e00", "no-app-open"), ("5515", "device-locked")] {
            let picked = try picker()
            let model = picked.model
            let device = picked.device

            device.version = try Self.bytes(status)
            await model.choose(ledger)
            XCTAssertEqual(model.stage, .failed(try Self.message(code)), status)
        }
    }

    func testADisconnectMidReadFailsAndRetryListsLedgersAgain() async throws {
        // Lost at the version check it is a disconnect; lost at a key, the core reads it as the
        // Starknet library's swallowed failure, as the extension does.
        let picked = try picker()
        let model = picked.model
        let scanner = picked.scanner
        let device = picked.device

        device.disconnectAfter = 0
        await model.choose(ledger)
        XCTAssertEqual(model.stage, .failed(try Self.message("disconnected-mid-sign")))
        let laterFixture = try picker()
        let later = laterFixture.model
        let laterDevice = laterFixture.device

        laterDevice.disconnectAfter = 1
        await later.choose(ledger)
        XCTAssertEqual(later.stage, .failed(try Self.message("unexpected-device-error")))
        XCTAssertTrue(device.closed)
        model.retry()
        XCTAssertEqual(model.stage, .scanning)
        XCTAssertEqual(scanner.scans, 2)
    }

    func testAFailedConnectionAsksForAReconnect() async throws {
        let scanner = FakeScanner(bluetooth: .ready, devices: [ledger])
        let model = LedgerConnectModel(
            scanner: scanner,
            connect: { _ in throw LedgerLinkError.disconnected },
            place: Self.place,
            existing: []
        )
        await model.choose(ledger)
        XCTAssertEqual(model.stage, .failed(try Self.message("replug")))
    }

    func testPermissionDeniedAndBluetoothOffNeverScan() throws {
        for state in [LedgerBluetooth.unauthorized, .off, .unsupported] {
            let picked = try picker(bluetooth: state)
            let model = picked.model
            let scanner = picked.scanner

            XCTAssertEqual(model.stage, .bluetooth(state))
            XCTAssertEqual(scanner.scans, 0)
            XCTAssertNotNil(LedgerCopy.bluetooth(state))
            scanner.set(.ready)
            XCTAssertEqual(model.stage, .scanning)
            XCTAssertEqual(scanner.scans, 1)
            XCTAssertEqual(model.devices, [ledger])
            scanner.set(.off)
            XCTAssertEqual(model.stage, .bluetooth(.off))
        }
    }

    func testAnAccountAlreadyInTheWalletCannotBePicked() async throws {
        let placed = try Self.place([
            LedgerKey(
                scheme: .bramble,
                accountIndex: 0,
                publicKeyX: "0x23156521d2acf1de4e36ff383f1281437cace4bf231a547a7f9f4aff7cc409d"
            )
        ])
        let held = try XCTUnwrap(placed.first?.address).uppercased()
        let picked = try picker(existing: [held])
        let model = picked.model

        await model.choose(ledger)
        let first = try XCTUnwrap(model.candidates.first)
        XCTAssertTrue(model.isExisting(first))
        model.toggle(first)
        XCTAssertTrue(model.chosen.isEmpty)
    }

    // MARK: Fixtures

    private func picker(
        bluetooth: LedgerBluetooth = .ready,
        existing: Set<String> = []
    ) throws -> Picker {
        let scanner = FakeScanner(bluetooth: bluetooth, devices: [ledger])
        let device = ReplayDevice(script: try Self.recordedExchanges())
        let model = LedgerConnectModel(
            scanner: scanner,
            connect: { _ in device },
            place: Self.place,
            existing: existing,
            pageSize: 1
        )
        return Picker(model: model, scanner: scanner, device: device)
    }

    private struct Picker {
        let model: LedgerConnectModel
        let scanner: FakeScanner
        let device: ReplayDevice
    }

    private static func place(_ keys: [LedgerKey]) throws -> [LedgerCandidate] {
        try ledgerAccountCandidates(network: .mainnet, family: .openZeppelin, keys: keys)
    }

    private static func message(_ code: String) throws -> String {
        try XCTUnwrap(FriendlyErrorRules.ledgerMessages[code])
    }

    /// Every recorded `{request, reply}`; a request recorded twice keeps its first reply.
    private static func recordedExchanges() throws -> [Data: Data] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "extension-ledger", withExtension: "jsonl"))
        var script: [Data: Data] = [:]
        for line in try String(contentsOf: url, encoding: .utf8).split(separator: "\n") {
            let block = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
            guard block["recorded"] as? Bool != false else { continue }
            for pair in block["exchanges"] as? [[String: String]] ?? [] {
                let request = try bytes(XCTUnwrap(pair["request"]))
                if script[request] == nil { script[request] = try bytes(XCTUnwrap(pair["reply"])) }
            }
        }
        return script
    }

    fileprivate static func bytes(_ hex: String) throws -> Data {
        let digits = Array(hex.utf8)
        return try Data(stride(from: 0, to: digits.count, by: 2).map { index in
            try XCTUnwrap(UInt8(String(decoding: digits[index ... index + 1], as: UTF8.self), radix: 16))
        })
    }
}

@MainActor
private final class FakeScanner: LedgerScanning {
    private(set) var bluetooth: LedgerBluetooth
    private(set) var devices: [LedgerDevice] = []
    var changed: (() -> Void)?
    private(set) var scans = 0
    private let nearby: [LedgerDevice]

    init(bluetooth: LedgerBluetooth, devices: [LedgerDevice]) {
        self.bluetooth = bluetooth
        nearby = devices
    }

    func set(_ state: LedgerBluetooth) {
        bluetooth = state
        if state != .ready { devices = [] }
        changed?()
    }

    func startScan() {
        guard bluetooth == .ready else { return }
        scans += 1
        devices = nearby
    }

    func stopScan() {
        // Nothing to stop: the fake lists its devices at once.
    }
}

/// A Starknet app answering from the transcripts; `version` replaces the app-version reply.
@MainActor
private final class ReplayDevice: LedgerExchanging {
    /// The Starknet app's class byte; the version request is it and four zeros.
    private static let starknetCla: UInt8 = 0x5a
    private static let versionRequest = Data([starknetCla, 0, 0, 0, 0])
    let script: [Data: Data]
    var version: Data?
    /// After this many replies, every exchange is a disconnect.
    var disconnectAfter: Int?
    private(set) var closed = false
    private var replies = 0

    init(script: [Data: Data]) {
        self.script = script
    }

    func send(_ apdu: Data) -> LedgerExchange {
        guard !closed else { return .failure(.disconnected) }
        if let disconnectAfter, replies >= disconnectAfter { return .failure(.disconnected) }
        replies += 1
        if apdu == Self.versionRequest, let version { return .reply(version) }
        guard let reply = script[apdu] else { return .failure(.other) }
        return .reply(reply)
    }

    func close() {
        closed = true
    }
}
