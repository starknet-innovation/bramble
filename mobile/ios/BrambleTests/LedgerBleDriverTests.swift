@testable import Bramble
import BrambleCore
import Foundation
import XCTest

/// `LedgerBleDriver` over a fake link that plays the device: it answers the MTU request, puts the
/// written frames back together with the core's reassembler and answers each APDU with its reply
/// from the Speculos transcripts (`extension-ledger.jsonl`), framed by the core's own framing.
@MainActor
final class LedgerBleDriverTests: XCTestCase {
    private static let mtuAnswerOp: UInt8 = 0x08

    func testEveryRecordedExchangeComesBackByteExact() async throws {
        let exchanges = try Self.recordedExchanges()
        XCTAssertFalse(exchanges.isEmpty)
        // The default 20-byte frames split most replies; a larger device MTU and a host write
        // limit below it check that the smaller one wins.
        for (deviceSize, hostLimit) in [(20, 20), (153, 100)] {
            let link = FakeLedgerLink(deviceFrameSize: UInt8(deviceSize), maximumWriteLength: hostLimit)
            link.script = exchanges
            let driver = LedgerBleDriver(link: link)
            for (request, reply) in exchanges {
                let outcome = await driver.exchange(request)
                XCTAssertEqual(outcome, .reply(reply))
            }
            XCTAssertEqual(link.requests, exchanges.map(\.request))
            XCTAssertTrue(link.written.allSatisfy { $0.count <= min(deviceSize, hostLimit) })
        }
    }

    func testTheHandshakeDropsANotificationThatIsNotAnMtuAnswer() async throws {
        let (request, reply) = try XCTUnwrap(Self.recordedExchanges().first)
        let link = FakeLedgerLink(deviceFrameSize: 64, maximumWriteLength: 64)
        link.beforeMtuAnswer = [Data([0x05, 0, 0]), Data([Self.mtuAnswerOp, 0])]
        link.script = [(request, reply)]
        let outcome = await LedgerBleDriver(link: link).exchange(request)
        XCTAssertEqual(outcome, .reply(reply))
        XCTAssertEqual(link.written.first, ledgerBleLink().mtuRequest)
    }

    func testADisconnectMidReplyIsADisconnectedFailure() async throws {
        let (request, reply) = try XCTUnwrap(Self.recordedExchanges().first { $0.reply.count > 40 })
        let link = FakeLedgerLink(deviceFrameSize: 20, maximumWriteLength: 20)
        link.script = [(request, reply)]
        link.replyFramesBeforeDisconnect = 1
        let outcome = await LedgerBleDriver(link: link).exchange(request)
        XCTAssertEqual(outcome, .failure(.disconnected))
    }

    func testASilentDeviceTimesOutAndClosesTheLink() async throws {
        let (request, _) = try XCTUnwrap(Self.recordedExchanges().first)
        let link = FakeLedgerLink(deviceFrameSize: 20, maximumWriteLength: 20)
        let driver = LedgerBleDriver(link: link)
        // No script: the device answers the MTU request, then never replies.
        let outcome = await driver.exchange(request, timeoutMs: 50)
        XCTAssertEqual(outcome, .failure(.other))
        XCTAssertTrue(link.closed)
        let after = await driver.exchange(request)
        XCTAssertEqual(after, .failure(.disconnected))
    }

    func testMalformedReplyFramesAreTheCoresFailure() async throws {
        let (request, _) = try XCTUnwrap(Self.recordedExchanges().first)
        let link = FakeLedgerLink(deviceFrameSize: 20, maximumWriteLength: 20)
        link.script = [(request, Data())]
        link.rawReply = [Data([0x05, 0, 1, 0, 2, 0x90, 0])]
        let outcome = await LedgerBleDriver(link: link).exchange(request)
        XCTAssertEqual(outcome, .failure(.other))
        XCTAssertTrue(link.closed)
    }

    func testTheCoreBluetoothLinkFailsClosedWithoutBluetooth() async {
        // The simulator has no Bluetooth: nothing is found and a connection is refused, closed.
        let link = LedgerBleLink()
        XCTAssertTrue(link.ledgers(remembered: [UUID()]).isEmpty)
        do {
            try await link.connect(UUID())
            XCTFail("connected without Bluetooth")
        } catch {
            XCTAssertEqual(error as? LedgerLinkError, .disconnected)
        }
        let outcome = await LedgerBleDriver(link: link).exchange(Data([0x5a, 0, 0, 0, 0]))
        XCTAssertEqual(outcome, .failure(.disconnected))
    }

    /// Every `{request, reply}` in the transcripts, in file order.
    private static func recordedExchanges() throws -> [(request: Data, reply: Data)] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "extension-ledger", withExtension: "jsonl"))
        return try String(contentsOf: url, encoding: .utf8).split(separator: "\n").flatMap { line in
            let block = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
            return try (block["exchanges"] as? [[String: String]] ?? []).map { pair in
                try (bytes(XCTUnwrap(pair["request"])), bytes(XCTUnwrap(pair["reply"])))
            }
        }
    }

    private static func bytes(_ hex: String) throws -> Data {
        let digits = Array(hex.utf8)
        XCTAssertEqual(digits.count % 2, 0)
        return try Data(stride(from: 0, to: digits.count, by: 2).map { index in
            try XCTUnwrap(UInt8(String(decoding: digits[index ... index + 1], as: UTF8.self), radix: 16))
        })
    }
}

/// A device behind a link: the MTU answer, then each scripted reply in the core's framing.
@MainActor
private final class FakeLedgerLink: LedgerLink {
    private static let anyFrameSize: UInt32 = 20
    let maximumWriteLength: Int
    var script: [(request: Data, reply: Data)] = []
    var beforeMtuAnswer: [Data] = []
    var replyFramesBeforeDisconnect: Int?
    /// Sent in place of the framed reply when not empty.
    var rawReply: [Data] = []
    private(set) var written: [Data] = []
    private(set) var requests: [Data] = []
    private(set) var closed = false
    private let deviceFrameSize: UInt8
    private var incoming: LedgerBleExchange?
    private var outbox: [Data] = []
    private var disconnectWhenEmpty = false
    private var waiter: CheckedContinuation<Data, Error>?

    init(deviceFrameSize: UInt8, maximumWriteLength: Int) {
        self.deviceFrameSize = deviceFrameSize
        self.maximumWriteLength = maximumWriteLength
    }

    func write(_ frame: Data) throws {
        guard !closed else { throw LedgerLinkError.disconnected }
        written.append(frame)
        if frame == ledgerBleLink().mtuRequest {
            // The MTU answer is the request's bytes followed by the device's frame size.
            send(beforeMtuAnswer + [ledgerBleLink().mtuRequest + [deviceFrameSize]])
            return
        }
        // Any APDU-sized placeholder: only its reassembler is used.
        let reassembler = try incoming ?? LedgerBleExchange(apdu: Data([0]), frameSize: Self.anyFrameSize)
        incoming = reassembler
        guard case let .reply(request) = reassembler.push(frame: frame) else { return }
        incoming = nil
        requests.append(request)
        guard !script.isEmpty else { return }
        let reply = script.removeFirst().reply
        var frames = try rawReply.isEmpty
            ? LedgerBleExchange(apdu: reply, frameSize: UInt32(deviceFrameSize)).frames().map(\.bytes)
            : rawReply
        if let cut = replyFramesBeforeDisconnect {
            frames = Array(frames.prefix(cut))
            disconnectWhenEmpty = true
        }
        send(frames)
    }

    func nextNotification() async throws -> Data {
        guard !closed else { throw LedgerLinkError.disconnected }
        if !outbox.isEmpty { return outbox.removeFirst() }
        if disconnectWhenEmpty {
            closed = true
            throw LedgerLinkError.disconnected
        }
        return try await withCheckedThrowingContinuation { waiter = $0 }
    }

    func close() {
        closed = true
        waiter?.resume(throwing: LedgerLinkError.disconnected)
        waiter = nil
    }

    private func send(_ frames: [Data]) {
        outbox += frames
        if let waiter, !outbox.isEmpty {
            self.waiter = nil
            waiter.resume(returning: outbox.removeFirst())
        }
    }
}
