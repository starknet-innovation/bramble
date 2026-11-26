import BrambleCore
import Foundation

/// What the driver needs from a connected Bluetooth link: whole writes and notifications in order.
/// `LedgerBleLink` is the CoreBluetooth one; tests swap in a fake.
@MainActor
protocol LedgerLink: AnyObject, Sendable {
    /// The longest value one write may carry.
    var maximumWriteLength: Int { get }
    /// Writes `frame` whole to the write characteristic. Throws `LedgerLinkError` when it fails.
    func write(_ frame: Data) async throws
    /// The next notification, in arrival order. Throws `LedgerLinkError` when the link ends.
    func nextNotification() async throws -> Data
    /// Ends the link; every pending and later call throws `LedgerLinkError.disconnected`.
    func close()
}

/// Why a link call failed.
enum LedgerLinkError: Error {
    case disconnected
    case failed
}

/// One APDU's outcome, in the form every Ledger consumer takes: `reply` goes to a reader's or
/// plan's `reply` (`StepReply.device`), `failure` to its `transportFailure` (`.deviceFailure`).
enum LedgerExchange: Equatable {
    case reply(Data)
    case failure(TransportFailure)
}

/// Moves one APDU at a time over a `LedgerLink`: the MTU handshake on first use, then the core's
/// framing out and reassembly in (`LedgerBleExchange`). It never reads or alters an APDU; what
/// the device answers is untrusted and goes to the core as is.
///
/// Failure: a disconnect is `.disconnected`; a timeout, a failed write or malformed frames are
/// `.other`. Every failure closes the link, so a late or stray frame can never answer the next
/// APDU; the host connects a new link and driver.
@MainActor
final class LedgerBleDriver {
    /// How long the device has to answer the MTU request.
    static let handshakeTimeoutMs: UInt32 = 5_000
    /// How long one APDU may wait for its reply. A signature waits for the person to review it on
    /// the device, so this is long.
    static let replyTimeoutMs: UInt32 = 300_000

    private let link: any LedgerLink
    private let setup = ledgerBleLink()
    private var frameSize: UInt32?
    private var busy = false

    init(link: any LedgerLink) {
        self.link = link
    }

    /// Sends `apdu` and returns the device's reply (data then status word) or the transport
    /// failure. One exchange at a time: a second concurrent call fails without writing.
    func exchange(_ apdu: Data, timeoutMs: UInt32 = replyTimeoutMs) async -> LedgerExchange {
        guard !busy else { return .failure(.other) }
        busy = true
        defer { busy = false }
        let outcome: LedgerExchange
        do {
            let size = try await negotiatedFrameSize()
            let exchange = try LedgerBleExchange(apdu: apdu, frameSize: size)
            outcome = try await timed(timeoutMs) { [link] in try await Self.run(exchange, over: link) }
        } catch {
            outcome = .failure(Self.failure(error))
        }
        // Any failure leaves the frame stream out of step with the device: end the link.
        if case .failure = outcome { link.close() }
        return outcome
    }

    private func negotiatedFrameSize() async throws -> UInt32 {
        if let frameSize { return frameSize }
        let request = setup.mtuRequest
        let answer = try await timed(Self.handshakeTimeoutMs) { [link] in
            try await link.write(request)
            while true {
                let note = try await link.nextNotification()
                // Anything that is not an MTU answer is dropped, as Ledger's transports do.
                if let size = try? ledgerBleFrameSize(mtuReply: note) { return size }
            }
        }
        let size = min(answer, UInt32(clamping: link.maximumWriteLength))
        frameSize = size
        return size
    }

    /// Ends the link; later exchanges fail as `.disconnected`.
    func close() {
        link.close()
    }

    private static func run(_ exchange: LedgerBleExchange, over link: any LedgerLink) async throws -> LedgerExchange {
        for frame in exchange.frames() { try await link.write(frame.bytes) }
        while true {
            switch exchange.push(frame: try await link.nextNotification()) {
            case .more:
                continue

            case let .reply(reply):
                return .reply(reply)

            case let .failed(failure):
                return .failure(failure)
            }
        }
    }

    /// `body` under `withTimeout`. The link's waits ignore task cancellation, so the link is
    /// closed when the timer wins or the caller cancels; that is what ends a pending wait.
    private func timed<T: Sendable>(
        _ milliseconds: UInt32,
        _ body: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        let abandon: @Sendable () -> Void = { [link] in Task { @MainActor in link.close() } }
        return try await withTaskCancellationHandler {
            try await withTimeout(milliseconds, onTimeout: abandon, body)
        } onCancel: {
            abandon()
        }
    }

    private static func failure(_ error: Error) -> TransportFailure {
        (error as? LedgerLinkError) == .disconnected ? .disconnected : .other
    }
}
