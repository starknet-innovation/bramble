import BrambleCore

/// The sans-IO reads the allowance exports share (`AllowanceListing`, `AllowanceRevoke`): the core
/// decides every call and judges every reply; the host only moves the bytes.
protocol AllowanceReads: AnyObject, Sendable {
    func nextCalls() -> [RpcRequest]
    func accept(reply: RpcReply) -> ScanStep
    func restart()
}

extension AllowanceListing: AllowanceReads {}
extension AllowanceRevoke: AllowanceReads {}

/// What the allowance manager shows for the active account (`AllowanceListing` in the extension's
/// responses): reading, the core's list, or no answer at all.
enum AllowanceListState: Equatable {
    case loading
    case loaded(AllowanceList)
    /// The core refused the listing (locked, an unknown account): nothing is vouched for.
    case unavailable
}

extension PortfolioEndpoints {
    /// Runs `reads`' current read on the first verified endpoint that answers it, replaying it from
    /// the start on the next after a transport failure. False when no endpoint answered.
    func drive(_ reads: some AllowanceReads, on network: NetworkInfo) async -> Bool {
        await firstAnswer(on: network) { url in
            reads.restart()
            while true {
                let calls = reads.nextCalls()
                if calls.isEmpty { return true }
                for reply in await send(calls, to: url) where reads.accept(reply: reply) == .transport {
                    return nil
                }
            }
        } ?? false
    }

    /// Drives `listing` to its end and lists. A read no endpoint answers is given up, so the core
    /// lists what it can and says the list is partial (`scanIncomplete`).
    func list(_ listing: AllowanceListing, on network: NetworkInfo) async -> AllowanceListState {
        // Two reads (discovery, then the tracked amounts); each may be given up once.
        for _ in 0..<AllowanceDriving.reads {
            if await drive(listing, on: network) { break }
            listing.giveUp()
        }
        guard let list = try? listing.finish() else { return .unavailable }
        return .loaded(list)
    }
}

/// The allowance manager on top of `WalletStore` (Settings › Token allowances), mirroring the
/// extension's `wallet.allowances` and `wallet.revokeAllowance` handlers. The core lists, settles
/// and plans; this file only drives its reads and opens the revoke over the Send driver.
extension WalletStore {
    /// Reads a listing for the active account over its network's trusted tokens: the discovery
    /// scan, then the live amount of every tracked grant.
    func loadAllowances() async -> AllowanceListState {
        guard let account = activeRecord,
              let listing = try? core.allowanceListing(accountId: account.id, tokens: portfolio.preferences)
        else { return .unavailable }
        return await portfolio.endpoints.list(listing, on: networkInfo)
    }

    /// The tracked tokens on this network, for the rows' units.
    var allowanceTokens: [TokenConfig] {
        portfolio.preferences.tracked(network: network).map(\.token)
    }

    /// A revoke of `allowance` from the active account, or nil while locked. The plan is tracked
    /// so a lock cancels it.
    func makeRevokeModel(_ allowance: AllowanceView) -> RevokeFlowModel? {
        guard let account = activeRecord else { return nil }
        let feeBalance: () -> String? = { [weak self] in self?.balances["STRK"] }
        return RevokeFlowModel(
            core: core,
            network: networkInfo,
            account: account,
            allowance: allowance,
            tokens: portfolio.preferences,
            feeBalance: feeBalance,
            endpoints: portfolio.endpoints,
            transport: rpc.transport
        ) { [weak self] plan in self?.plans.append(plan) }
    }
}

private enum AllowanceDriving {
    /// The listing's reads: discovery, then the tracked amounts.
    static let reads = 2
}
