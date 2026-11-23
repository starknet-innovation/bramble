import BrambleCore
import Foundation

/// Moves Nostr relay frames for one coordination sync. The core's `NostrSyncPlan` builds the REQ
/// and CLOSE frames and judges every frame received; this type only owns sockets and timers
/// (`nostr_relay.rs`, mirroring the extension's `nostr-relay-socket.ts`).
protocol RelayTransport: Sendable {
    func sync(_ plan: NostrSyncPlan, policy: RelayPolicy) async
}

struct RelayTimeout: Error {}

/// Which of `withTimeout`'s two children finished first.
private final class Settled: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    /// True for the first caller only.
    func claim() -> Bool {
        lock.withLock {
            defer { done = true }
            return !done
        }
    }
}

/// Runs `body`, failing with `RelayTimeout` once `milliseconds` pass. The group waits for `body`
/// to return even when cancelled, and a socket's `send`/`receive` ignore task cancellation, so
/// `onTimeout` (cancelling the socket) is what ends a hung one. It runs only when the timer wins:
/// a `body` that finishes at the deadline keeps its socket and its result, and one that finishes
/// after the timer won still fails with `RelayTimeout`.
func withTimeout<T: Sendable>(
    _ milliseconds: UInt32,
    onTimeout: @escaping @Sendable () -> Void,
    _ body: @escaping @Sendable () async throws -> T
) async throws -> T {
    let settled = Settled()
    return try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask {
            let result: Result<T, Error>
            do { result = try .success(await body()) } catch { result = .failure(error) }
            guard settled.claim() else { throw RelayTimeout() }
            return try result.get()
        }
        group.addTask {
            try await Task.sleep(for: .milliseconds(Int(milliseconds)))
            guard settled.claim() else {
                // `body` won and is returning; wait to be cancelled rather than race its result.
                try await Task.sleep(for: .milliseconds(Int(milliseconds)))
                throw RelayTimeout()
            }
            onTimeout()
            throw RelayTimeout()
        }
        defer { group.cancelAll() }
        guard let first = try await group.next() else { throw RelayTimeout() }
        return first
    }
}

/// One `wss://` socket per relay from an ephemeral session, opened only for the sync and closed
/// when the core finishes it, on timeout, on error, or when the sync task is cancelled (lock).
struct WebSocketRelayTransport: RelayTransport {
    /// Larger than the core's 140,000-byte frame limit so the core, not the socket, judges size and
    /// ignores an oversized frame as the extension does. Beyond this the socket fails, which ends
    /// the relay while keeping the events it already delivered.
    private static let maximumMessageSize = 1_048_576

    func sync(_ plan: NostrSyncPlan, policy: RelayPolicy) async {
        await withTaskGroup(of: Void.self) { group in
            for (index, raw) in plan.relayUrls().enumerated() {
                group.addTask { await Self.run(plan, relay: UInt32(index), url: raw, policy: policy) }
            }
        }
    }

    /// What the read loop does next, once `follow` has sent what the core's step asks for.
    enum RelayRead: Equatable {
        case keepReading
        case pageRequested
        case finished
    }

    /// Sends the frames `step` asks for, in order. A next page closes the full subscription and
    /// opens the older one on the same socket; a failed close at the end is not an error.
    static func follow(_ step: RelayStep, send: (String) async throws -> Void) async throws -> RelayRead {
        switch step {
        case .continue:
            return .keepReading

        case let .nextPage(closeFrame, request):
            try await send(closeFrame)
            try await send(request)
            return .pageRequested

        case let .finish(closeFrame):
            if let closeFrame { try? await send(closeFrame) }
            return .finished
        }
    }

    private static func run(_ plan: NostrSyncPlan, relay: UInt32, url raw: String, policy: RelayPolicy) async {
        guard let url = URL(string: raw), url.scheme?.lowercased() == "wss" else {
            plan.relayEnded(relay: relay)
            return
        }
        let session = URLSession(configuration: .ephemeral)
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = maximumMessageSize
        task.resume()
        defer {
            task.cancel(with: .normalClosure, reason: nil)
            session.invalidateAndCancel()
        }
        do {
            let open = plan.openFrame(relay: relay)
            let abandon: @Sendable () -> Void = { task.cancel(with: .goingAway, reason: nil) }
            try await withTimeout(policy.connectTimeoutMs, onTimeout: abandon) { try await task.send(.string(open)) }
            // Each page's request has its own timeout, as each extension subscription does.
            var deadline = ContinuousClock.now + .milliseconds(Int(policy.requestTimeoutMs))
            while true {
                let remaining = ContinuousClock.now.duration(to: deadline)
                guard remaining > .zero else { throw RelayTimeout() }
                let millis = UInt32(max(1, (remaining / .milliseconds(1)).rounded(.up)))
                let message = try await withTimeout(millis, onTimeout: abandon) { try await task.receive() }
                // The extension reads text frames only; binary frames are ignored.
                guard case .string(let text) = message else { continue }
                let step = plan.acceptFrame(relay: relay, frame: text)
                // A send that never completes ends the relay rather than holding the sync open.
                let read = try await follow(step) { frame in
                    try await withTimeout(policy.requestTimeoutMs, onTimeout: abandon) {
                        try await task.send(.string(frame))
                    }
                }
                switch read {
                case .keepReading:
                    continue

                case .pageRequested:
                    deadline = ContinuousClock.now + .milliseconds(Int(policy.requestTimeoutMs))

                case .finished:
                    return
                }
            }
        } catch {
            plan.relayEnded(relay: relay)
        }
    }
}

#if DEBUG
/// Scripted relay for UI tests (`-BrambleStubRelay YES`); never compiled into release builds. The
/// first relay delivers `events` (JSON event objects) then EOSE; any other relay times out.
struct StubRelayTransport: RelayTransport {
    let events: [String]

    func sync(_ plan: NostrSyncPlan, policy _: RelayPolicy) {
        for index in plan.relayUrls().indices where index > 0 { plan.relayEnded(relay: UInt32(index)) }
        guard !plan.relayUrls().isEmpty else { return }
        for event in events {
            _ = plan.acceptFrame(relay: 0, frame: #"["EVENT","mcw-1",\#(event)]"#)
        }
        _ = plan.acceptFrame(relay: 0, frame: #"["EOSE","mcw-1"]"#)
    }
}
#endif
