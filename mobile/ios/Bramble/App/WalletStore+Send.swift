import BrambleCore
import Foundation

/// Send, deploy and local activity on top of `WalletStore`. Kept in its own file so the store
/// itself only gained the few stored properties these need.
extension WalletStore {
    /// Why the active account cannot send, in the words the Send action shows instead of opening
    /// the journey; nil for an account the core signs for. The core refuses the same records
    /// (`SendError.ViewOnlyAccount` / `.UnsupportedAccount`), so this only saves a dead end.
    var sendRefusal: String? {
        guard let account = activeRecord else { return nil }
        if account.viewOnly { return BrambleCopy.sendViewOnlyAccount }
        return account.family == .openZeppelin ? nil : BrambleCopy.sendUnsupportedAccount
    }

    /// A Send journey for the active account, or nil while locked or when it cannot send.
    func makeSendModel() -> SendFlowModel? {
        guard let account = activeRecord, sendRefusal == nil else { return nil }
        return SendFlowModel(
            core: core,
            network: networkInfo,
            account: account,
            otherAccounts: records.filter { $0.id != account.id },
            balances: balances,
            transport: rpc.transport,
            track: { [weak self] plan in self?.plans.append(plan) }
        )
    }

    /// The standalone Deploy account flow for the active account (OpenZeppelin only: the core
    /// builds no other family's deployment).
    func makeDeployModel() -> DeployFlowModel? {
        guard let account = activeRecord, sendRefusal == nil else { return nil }
        return DeployFlowModel(core: core, network: networkInfo, accountId: account.id, transport: rpc.transport) { [weak self] plan in
            self?.plans.append(plan)
        }
    }

    /// Refreshes the deploy notice and the activity list, then settles pending records through
    /// the core's status reconciliation (never signs; three not-found answers mark a record
    /// rejected). This is how a send whose reply was lost to backgrounding gets its outcome.
    /// Only records the core says are still observed (unresolved, under an hour old) are read,
    /// each at most once per observation period, as the extension's `tx-observation.ts`; older
    /// ones keep the status they have.
    func refreshSendState() async {
        guard let account = activeRecord else { return }
        let network = networkInfo
        // The deploy notice is for accounts this core can deploy; others never show it.
        deployment = sendRefusal == nil ? await rpc.deploymentState(of: account.address, on: network) : .unknown
        portfolio.reloadActivity()
        let now = UInt64(Date().timeIntervalSince1970 * 1000)
        let period = activityObservationPeriodMs()
        for record in activity where activityNeedsObservation(record: record, nowMs: now) {
            if let last = observedAtMs[record.hash], now &- last < period { continue }
            observedAtMs[record.hash] = now
            guard let plan = try? core.refreshActivity(accountId: account.id, hash: record.hash) else { continue }
            _ = try? await SendDriver(plan: plan, network: network, transport: rpc.transport).run(from: .start)
        }
        portfolio.reloadActivity()
    }
}
