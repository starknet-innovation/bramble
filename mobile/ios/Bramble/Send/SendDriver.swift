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
    let plan: TransferPlan
    private let endpoint: RpcEndpoint

    init(plan: TransferPlan, network: NetworkInfo, transport: RpcTransport) {
        self.plan = plan
        endpoint = RpcEndpoint(network: network, transport: transport)
    }

    /// Lets a review retry probe the endpoints again. Refused once a write has been sent.
    func releaseEndpoint() async {
        await endpoint.release()
    }

    /// Advances the plan from `reply` until it needs the user (`Review`, `Broadcast`, `Finished`,
    /// `Failed`); a device step is `Failed` as `signingFailed`. `onStep` sees every RPC step before
    /// it is sent, so the UI can follow progress.
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
                reply = await endpoint.exchange(id: id, body: body, purpose: purpose, write: isWrite)

            case let .wait(delayMs):
                try await Task.sleep(for: .milliseconds(Int(delayMs)))
                reply = .waitElapsed

            case .device, .deviceRetry:
                // Mobile signs on no device (P8): a Ledger account's plan ends here, unsigned, for
                // every flow this driver runs.
                return .failed(failure: SendFailure(code: .signingFailed, hash: nil))

            default:
                return step
            }
        }
    }
}

/// One plan's endpoint binding, shared by every sans-IO plan the core hands out (`SendDriver`,
/// `MultisigTxDriver`): the first `ChainId` step binds the first endpoint that proves the chain,
/// every later step of the plan goes to that endpoint with no failover, and a write is sent
/// exactly once, never retried, never redirected.
actor RpcEndpoint {
    /// Milliseconds per second, for the host clock the plan reads.
    private static let millisecondsPerSecond: Double = 1_000

    private let urls: [URL]
    private let network: NetworkId
    private let transport: RpcTransport
    private(set) var endpoint: URL?
    private(set) var writesSent = 0

    init(network: NetworkInfo, transport: RpcTransport) {
        self.urls = network.rpcUrls.compactMap(URL.init(string:))
        self.network = network.network
        self.transport = transport
    }

    /// Lets a retry probe the endpoints again. Refused once a write has been sent.
    func release() {
        if writesSent == 0 { endpoint = nil }
    }

    private func now() -> UInt64 { UInt64(Date().timeIntervalSince1970 * Self.millisecondsPerSecond) }

    /// Sends one step and returns the reply the plan reads; every failure is a `transportFailure`.
    func exchange(id: UInt64, body: String, purpose: RpcPurpose, write: Bool) async -> StepReply {
        if endpoint == nil, purpose == .chainId, !write {
            return await bind(id: id, body: body)
        }
        // A status-only plan (activity refresh) has no ChainId step of its own: prove an
        // endpoint first with a chain probe of the driver's own. Never for a write.
        if endpoint == nil, !write { await probe() }
        guard let endpoint else { return .transportFailure(id: id, nowMs: now()) }
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
                return .rpc(id: id, body: text, nowMs: now())
            }
            mismatch = mismatch ?? text
        }
        if let mismatch { return .rpc(id: id, body: mismatch, nowMs: now()) }
        return .transportFailure(id: id, nowMs: now())
    }
}
