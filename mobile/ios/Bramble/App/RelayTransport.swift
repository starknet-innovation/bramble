import BrambleCore
import Foundation

/// Moves Nostr relay frames for one coordination sync. The core's `NostrSyncPlan` builds the REQ
/// and CLOSE frames and judges every frame received; this type only owns sockets and timers
/// (`nostr_relay.rs`, mirroring the extension's `nostr-relay-socket.ts`).
protocol RelayTransport: Sendable {
    func sync(_ plan: NostrSyncPlan, policy: RelayPolicy) async
}

private struct RelayTimeout: Error {}

/// Runs `body`, failing with `RelayTimeout` once `milliseconds` pass.
private func withTimeout<T: Sendable>(_ milliseconds: UInt32, _ body: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await body() }
        group.addTask {
            try await Task.sleep(for: .milliseconds(Int(milliseconds)))
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
            try await withTimeout(policy.connectTimeoutMs) { try await task.send(.string(open)) }
            let deadline = ContinuousClock.now + .milliseconds(Int(policy.requestTimeoutMs))
            while true {
                let remaining = ContinuousClock.now.duration(to: deadline)
                guard remaining > .zero else { throw RelayTimeout() }
                let millis = UInt32(max(1, (remaining / .milliseconds(1)).rounded(.up)))
                let message = try await withTimeout(millis) { try await task.receive() }
                // The extension reads text frames only; binary frames are ignored.
                guard case .string(let text) = message else { continue }
                if case .finish(let closeFrame) = plan.acceptFrame(relay: relay, frame: text) {
                    if let closeFrame { try? await task.send(.string(closeFrame)) }
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

    func sync(_ plan: NostrSyncPlan, policy: RelayPolicy) async {
        for index in plan.relayUrls().indices where index > 0 { plan.relayEnded(relay: UInt32(index)) }
        guard !plan.relayUrls().isEmpty else { return }
        for event in events {
            _ = plan.acceptFrame(relay: 0, frame: #"["EVENT","mcw-1",\#(event)]"#)
        }
        _ = plan.acceptFrame(relay: 0, frame: #"["EOSE","mcw-1"]"#)
    }
}
#endif
