import BrambleCore
import Observation

/// The selected account's private-balance reading (the extension's `PrivacyDisclosureState`).
/// Holds public results only: the registration flag, per-token totals, and the pool fee. Swift
/// never derives or reads the viewing key, but it does cross FFI once per discovery request,
/// inside the opaque `Post` body the driver sends and then wipes (docs/privacy.md §1.1, §5: the
/// owner-approved exemption). Nothing here is persisted. `reset()` runs synchronously on lock,
/// account switch and network switch, a read that finishes after a reset is dropped, and the core
/// ignores a reading taken on another network (the extension's scope guard).
@MainActor
@Observable
final class PrivacyModel {
    private(set) var reading: PrivacyReading = .idle
    private(set) var state: PrivacyState?
    private var plan: PrivacyReadPlan?
    private var task: Task<PrivacyStep?, Never>?
    private var generation = 0
    private var scope: (network: NetworkId, accountId: String)?

    /// Forgets the reading unless it belongs to this network and account, so nothing from the
    /// previous scope shows while the new one loads.
    func retain(network: NetworkId, accountId: String?) {
        guard let scope, scope.network == network, scope.accountId == accountId else {
            reset()
            return
        }
    }

    /// Closes any read in flight and forgets the last reading.
    func reset() {
        plan?.close()
        plan = nil
        task?.cancel()
        task = nil
        generation += 1
        reading = .idle
        state = nil
        scope = nil
    }

    /// Reads registration, private totals and the pool fee for one account record. An unrouted network
    /// (Sepolia, or any OHTTP network) settles as `unconfigured` without creating a plan.
    func refresh(
        core: WalletCore,
        network: NetworkInfo,
        accountId: String,
        rpc: RpcTransport,
        transports: (privacy: PrivacyTransport, rpc: RpcTransport)? = nil
    ) async {
        reset()
        let started = generation
        scope = (network.network, accountId)
        guard privacyConfigured(network: network.network) else {
            reading = .unconfigured
            return
        }
        guard let prepared = try? core.preparePrivacyRead(accountId: accountId) else {
            reading = .failed
            return
        }
        plan = prepared
        reading = .loading
        let chosen = transports ?? PrivacyTransports.launch(rpc: rpc)
        let driver = PrivacyDriver(plan: prepared, network: network, privacy: chosen.privacy, rpc: chosen.rpc)
        let work = Task { try? await driver.run() }
        task = work
        let step = await work.value
        guard started == generation else { return }
        self.plan = nil
        task = nil
        if case let .finished(state) = step {
            self.state = state
            reading = .settled(registration: state.registration)
        } else {
            reading = .failed
        }
    }
}
