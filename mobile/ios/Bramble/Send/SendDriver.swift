import BrambleCore
import Foundation

/// Relays one `TransferPlan`'s steps over a transport. The plan decides every step; the driver
/// only chooses the endpoint, sleeps for `Wait`, and hands replies back.
///
/// Host-side guarantees the core cannot see (mobile/docs/transactions.md §3, "Endpoint binding"):
/// the first `ChainId` step picks the first endpoint that proves the plan's chain, and every later
/// step of the plan goes to that same endpoint, with no failover; a write is sent exactly once,
/// never retried, never redirected.
///
/// A Ledger account's plan asks for its device (`Device`, `DeviceRetry`): the driver relays each
/// APDU through `signer` and, after a refusal, asks the person to try again or cancel. A cancel
/// closes the plan. The device link closes whenever `run` returns.
actor SendDriver {
    let plan: TransferPlan
    private let endpoint: RpcEndpoint
    private let signer: (any DeviceSigning)?
    private let account: AccountRecord?

    /// `signer` nil signs on the app's Bluetooth Ledger (`LedgerSigner.shared`) when the plan asks.
    /// `account` is the record the caller built `plan` for, shown on the Ledger sheet as the
    /// signer; nil shows none. Never pass any other record.
    init(
        plan: TransferPlan,
        network: NetworkInfo,
        transport: RpcTransport,
        account: AccountRecord? = nil,
        signer: (any DeviceSigning)? = nil
    ) {
        self.plan = plan
        endpoint = RpcEndpoint(network: network, transport: transport)
        self.account = account
        self.signer = signer
    }

    /// Lets a review retry probe the endpoints again. Refused once a write has been sent.
    func releaseEndpoint() async {
        await endpoint.release()
    }

    /// Advances the plan from `reply` until it needs the user (`Review`, `Broadcast`, `Finished`,
    /// `Failed`). Device steps are answered on the Ledger; a cancel there is `Failed` as
    /// `signingFailed`, the plan closed. `onStep` sees every RPC step before it is sent, so the UI
    /// can follow progress.
    func run(
        from initial: StepReply,
        onStep: @Sendable (SendStep) async -> Void = { _ in /* No progress to follow. */ }
    ) async throws -> SendStep {
        var device: (any DeviceSigning)?
        do {
            let step = try await relay(from: initial, onStep: onStep) { device = $0 }
            await device?.finish()
            return step
        } catch {
            await device?.finish()
            throw error
        }
    }

    private func relay(
        from initial: StepReply,
        onStep: @Sendable (SendStep) async -> Void,
        using: (any DeviceSigning) -> Void
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

            case let .device(apdu):
                let ledger = await deviceSigner()
                using(ledger)
                guard let answer = await ledger.exchange(apdu, for: account) else { return cancelled() }
                reply = answer

            case let .deviceRetry(reason):
                let ledger = await deviceSigner()
                using(ledger)
                guard await ledger.refused(reason, for: account) else { return cancelled() }
                reply = .retryDevice

            default:
                return step
            }
        }
    }
}

extension SendDriver {
    private func deviceSigner() async -> any DeviceSigning {
        if let signer { return signer }
        return await MainActor.run { LedgerSigner.shared }
    }

    /// The person cancelled on the device sheet: the plan closes with nothing signed.
    private func cancelled() -> SendStep {
        plan.cancel()
        return .failed(failure: SendFailure(code: .signingFailed, hash: nil))
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
