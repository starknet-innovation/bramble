import BrambleCore
import Foundation

/// Milliseconds per second, for the wall-clock time observation periods are measured in.
private let millisecondsPerSecond: Double = 1_000

/// Send, deploy and local activity on top of `WalletStore`. Kept in its own file so the store
/// itself only gained the few stored properties these need.
extension WalletStore {
    /// A Send journey for the active account, or nil while locked. An undeployed Braavos account is
    /// refused by the core's review (`braavosDeployFirst`), which names the way out.
    /// `token` opens it on that asset (a token screen's Send); the recipient is still chosen first.
    func makeSendModel(token: String? = nil) -> SendFlowModel? {
        guard let account = activeRecord else { return nil }
        return SendFlowModel(
            core: core,
            network: networkInfo,
            account: account,
            accounts: records,
            balances: balances,
            transport: rpc.transport,
            openingToken: token
        ) { [weak self] plan in self?.plans.append(plan) }
    }

    /// The standalone Deploy account flow for the active account (the core refuses a class it does
    /// not deploy, as the extension does).
    func makeDeployModel() -> DeployFlowModel? {
        guard let account = activeRecord else { return nil }
        return DeployFlowModel(
            core: core,
            network: networkInfo,
            accountId: account.id,
            transport: rpc.transport
        ) { [weak self] plan in
            self?.plans.append(plan)
        }
    }

    /// Refreshes the deployment reading and the activity list, then settles recorded transactions
    /// through `observeActivity`. This is how a send whose reply was lost to backgrounding gets
    /// its outcome.
    func refreshSendState() async {
        guard let account = activeRecord else { return }
        let network = networkInfo
        deployment = await rpc.deploymentState(of: account.address, on: network)
        await observeActivity()
    }

    /// One observation pass over the active account's records, as the extension's
    /// `tx-observation.ts`: only records the core says are still observed are read (unresolved
    /// ones for an hour, accepted ones awaiting L1 for seven days), each at most once per its
    /// tier's period, through the core's status reconciliation (never signs; three not-found
    /// answers mark a record rejected). Then the core retires records that outlived their hour
    /// and hands out the notices owed, each shown once as an error toast, as the side panel does.
    func observeActivity() async {
        guard let account = activeRecord else { return }
        let network = networkInfo
        portfolio.reloadActivity()
        let now = UInt64(Date().timeIntervalSince1970 * millisecondsPerSecond)
        for record in activity where activityNeedsObservation(record: record, nowMs: now) {
            let period = activityObservationPeriodFor(record: record)
            if let last = observedAtMs[record.hash], now &- last < period { continue }
            observedAtMs[record.hash] = now
            guard let plan = try? core.refreshActivity(accountId: account.id, hash: record.hash) else { continue }
            _ = try? await SendDriver(plan: plan, network: network, transport: rpc.transport).run(from: .start)
        }
        portfolio.reloadActivity()
        let settled = UInt64(Date().timeIntervalSince1970 * millisecondsPerSecond)
        let notices = (try? core.takeActivityNotices(accountId: account.id, nowMs: settled)) ?? []
        // The host shows one toast at a time: with several owed notices the latest shows, and
        // every record keeps its status in Activity either way.
        if let notice = notices.last { toast = notice }
    }

    /// Runs `observeActivity` every `activityObservationPeriodMs()` (the fast period, the
    /// shortest any record is read at) while the wallet is open: the foreground stand-in for the
    /// extension's two observation alarms. Replaces any running ticker; `lock()` cancels it.
    func startActivityObservation() {
        observationTicker?.cancel()
        let period = Int64(activityObservationPeriodMs())
        observationTicker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(period))
                guard !Task.isCancelled, let self else { return }
                if route == .wallet { await observeActivity() }
            }
        }
    }
}
