import BrambleCore

/// The Swap journey on top of `WalletStore`.
extension WalletStore {
    /// A Swap journey for the active account, or nil while locked. `token` (a tracked token id)
    /// opens it selling that token (a token screen's Swap). Quotes and builds travel the
    /// portfolio's bounded HTTP path; the plan travels the send transport and is tracked, so a lock
    /// cancels it.
    func makeSwapModel(token: String? = nil) -> SwapFlowModel? {
        guard let account = activeRecord else { return nil }
        let portfolio = portfolio
        var held: [String: String] = [:]
        for tracked in portfolio.tracked {
            if let row = portfolio.balance(of: tracked.token) { held[tracked.token.id] = row.balance }
        }
        return SwapFlowModel(
            core: core,
            network: networkInfo,
            accountId: account.id,
            preferences: portfolio.preferences,
            balances: held,
            prices: portfolio.priceView,
            http: portfolio.transport,
            rpc: rpc.transport,
            openingToken: token
        ) { [weak self] plan in self?.plans.append(plan) }
    }
}
