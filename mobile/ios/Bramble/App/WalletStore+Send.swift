import BrambleCore
import Foundation

/// Send, deploy and local activity on top of `WalletStore`. Kept in its own file so the store
/// itself only gained the few stored properties these need.
extension WalletStore {
    /// A Send journey for the selected account, or nil while locked.
    func makeSendModel() -> SendFlowModel? {
        guard let account else { return nil }
        return SendFlowModel(
            core: core,
            network: networkInfo,
            account: account,
            otherAccounts: accounts.filter { $0.index != account.index },
            balances: balances,
            transport: rpc.transport,
            track: { [weak self] plan in self?.plans.append(plan) }
        )
    }

    /// The standalone Deploy account flow for the selected account.
    func makeDeployModel() -> DeployFlowModel? {
        guard let account else { return nil }
        return DeployFlowModel(core: core, network: networkInfo, accountIndex: account.index, transport: rpc.transport) { [weak self] plan in
            self?.plans.append(plan)
        }
    }

    /// Refreshes the deploy notice and the local activity, then settles pending records through
    /// the core's status reconciliation (never signs; three not-found answers mark a record
    /// rejected). This is how a send whose reply was lost to backgrounding gets its outcome.
    /// Only records the core says are still observed (unresolved, under an hour old) are read,
    /// each at most once per observation period, as the extension's `tx-observation.ts`; older
    /// ones keep the status they have.
    func refreshSendState() async {
        guard let account else { return }
        let network = networkInfo
        deployment = await rpc.deploymentState(of: account.address, on: network)
        activity = (try? core.activity(network: network.network, accountIndex: account.index)) ?? []
        let now = UInt64(Date().timeIntervalSince1970 * 1000)
        let period = activityObservationPeriodMs()
        for record in activity where activityNeedsObservation(record: record, nowMs: now) {
            if let last = observedAtMs[record.hash], now &- last < period { continue }
            observedAtMs[record.hash] = now
            guard let plan = try? core.refreshActivity(network: network.network, accountIndex: account.index, hash: record.hash) else { continue }
            _ = try? await SendDriver(plan: plan, network: network, transport: rpc.transport).run(from: .start)
        }
        activity = (try? core.activity(network: network.network, accountIndex: account.index)) ?? activity
    }
}
