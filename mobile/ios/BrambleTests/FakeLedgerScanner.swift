@testable import Bramble
import BrambleCore
import Foundation
import XCTest

// Fakes for the Ledger connect-and-pick tests: a scanner, and a Starknet app that answers each
// APDU with its reply from the Speculos transcripts (`extension-ledger.jsonl`).

/// Every recorded `{request, reply}`; a request recorded twice keeps its first reply.
@MainActor
func recordedLedgerExchanges(bundle: Bundle) throws -> [Data: Data] {
    let url = try XCTUnwrap(bundle.url(forResource: "extension-ledger", withExtension: "jsonl"))
    var script: [Data: Data] = [:]
    for line in try String(contentsOf: url, encoding: .utf8).split(separator: "\n") {
        let block = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        guard block["recorded"] as? Bool != false else { continue }
        for pair in block["exchanges"] as? [[String: String]] ?? [] {
            let request = try hexBytes(XCTUnwrap(pair["request"]))
            if script[request] == nil { script[request] = try hexBytes(XCTUnwrap(pair["reply"])) }
        }
    }
    return script
}

/// Hex digits per byte, and their base.
private enum Hex {
    static let width = 2
    static let radix = 16
}

func hexBytes(_ hex: String) throws -> Data {
    let digits = Array(hex.utf8)
    return try Data(stride(from: 0, to: digits.count, by: Hex.width).map { index in
        let pair = String(decoding: digits[index ..< index + Hex.width], as: UTF8.self)
        return try XCTUnwrap(UInt8(pair, radix: Hex.radix))
    })
}

@MainActor
final class FakeLedgerScanner: LedgerScanning {
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
final class ReplayLedgerDevice: LedgerExchanging {
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
