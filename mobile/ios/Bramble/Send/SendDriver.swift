import BrambleCore
import Foundation

/// Relays one `TransferPlan`'s steps over a transport. The plan decides every step; the driver
/// only chooses the endpoint, sleeps for `Wait`, and hands replies back.
///
/// Host-side guarantees the core cannot see (mobile/docs/transactions.md §3, "Endpoint binding"):
/// the first `ChainId` step picks the first endpoint that proves the plan's chain, and every later
/// step of the plan goes to that same endpoint, with no failover; a write is sent exactly once,
/// never retried, never redirected.
actor SendDriver {
    /// Milliseconds per second, for the host clock the plan reads.
    private static let millisecondsPerSecond: Double = 1_000

    let plan: TransferPlan
    private let urls: [URL]
    private let network: NetworkId
    private let transport: RpcTransport
    private(set) var endpoint: URL?
    private(set) var writesSent = 0
    private(set) var endpointsUsed: Set<URL> = []

    init(plan: TransferPlan, network: NetworkInfo, transport: RpcTransport) {
        self.plan = plan
        self.urls = network.rpcUrls.compactMap(URL.init(string:))
        self.network = network.network
        self.transport = transport
    }

    /// Lets a review retry probe the endpoints again. Refused once a write has been sent.
    func releaseEndpoint() {
        if writesSent == 0 { endpoint = nil }
    }

    /// Advances the plan from `reply` until it needs the user (`Review`, `Broadcast`, `Finished`,
    /// `Failed`). `onStep` sees every RPC step before it is sent, so the UI can follow progress.
    func run(
        from initial: StepReply,
        onStep: @Sendable (SendStep) async -> Void = { _ in /* No progress to follow. */ }
    ) async throws -> SendStep {
        var reply = initial
        while true {
            let step = try plan.advance(reply: reply)
            switch step {
            case let .rpc(id, body, purpose, isWrite):
                await onStep(step)
                reply = await exchange(id: id, body: body, purpose: purpose, write: isWrite)

            case let .wait(delayMs):
                try await Task.sleep(for: .milliseconds(Int(delayMs)))
                reply = .waitElapsed

            default:
                return step
            }
        }
    }

    private func now() -> UInt64 { UInt64(Date().timeIntervalSince1970 * Self.millisecondsPerSecond) }

    private func exchange(id: UInt64, body: String, purpose: RpcPurpose, write: Bool) async -> StepReply {
        if endpoint == nil, purpose == .chainId, !write {
            return await bind(id: id, body: body)
        }
        // A status-only plan (activity refresh) has no ChainId step of its own: prove an
        // endpoint first with a chain probe of the driver's own. Never for a write.
        if endpoint == nil, !write { await probe() }
        guard let endpoint else { return .transportFailure(id: id, nowMs: now()) }
        endpointsUsed.insert(endpoint)
        if write { writesSent += 1 }
        do {
            let text = try await transport.post(body, to: endpoint, write: write)
            return .rpc(id: id, body: text, nowMs: now())
        } catch {
            return .transportFailure(id: id, nowMs: now())
        }
    }

    private func probe() async {
        for url in urls {
            guard let text = try? await transport.post(rpcChainIdRequest(id: 0), to: url, write: false),
                  (try? rpcVerifyChainId(body: text, id: 0, network: network)) == true else { continue }
            endpoint = url
            return
        }
    }

    /// Picks the first endpoint that proves the chain, as the extension's `selectWriteProvider`.
    private func bind(id: UInt64, body: String) async -> StepReply {
        var mismatch: String?
        for url in urls {
            guard let text = try? await transport.post(body, to: url, write: false) else { continue }
            if (try? rpcVerifyChainId(body: text, id: id, network: network)) == true {
                endpoint = url
                endpointsUsed.insert(url)
                return .rpc(id: id, body: text, nowMs: now())
            }
            mismatch = mismatch ?? text
        }
        if let mismatch { return .rpc(id: id, body: mismatch, nowMs: now()) }
        return .transportFailure(id: id, nowMs: now())
    }
}
