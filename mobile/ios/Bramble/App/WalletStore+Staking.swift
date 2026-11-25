import BrambleCore

/// Milliseconds per second: the portfolio clock reads milliseconds, the staking reads seconds.
private let millisecondsPerSecond: Double = 1_000

/// Staking (M21) on top of `WalletStore`: the screen's model and each action's, for the active
/// account. Whether staking shows at all is the core's `STAKING_POLICY` (Mainnet only), asked
/// through `StakingModel.refusal`, never a network check here.
extension WalletStore {
    /// Unix seconds from the portfolio's clock, so tests that pin it pin staking too.
    var stakingClock: @Sendable () -> UInt64 {
        let clock = portfolio.clock
        return { UInt64(clock() / millisecondsPerSecond) }
    }

    /// True where the core offers staking for the selected network and an account is open.
    var stakingAvailable: Bool {
        activeRecord != nil && StakingModel.refusal(on: network) == nil
    }

    /// The staking screen for the active account, or nil while locked.
    func makeStakingModel() -> StakingModel? {
        guard let account = activeRecord else { return nil }
        return StakingModel(
            core: core,
            network: networkInfo,
            accountId: account.id,
            tokens: portfolio.preferences,
            transport: portfolio.transport,
            clock: stakingClock
        )
    }

    /// `action` on `row`'s pool (validator and token) with the amount typed, for the account the
    /// screen was opened for. The plan is tracked, so a lock cancels it.
    func makeStakingAction(
        _ action: StakingAction,
        row: StakingRowView,
        amount: String?,
        on model: StakingModel
    ) -> StakingActionModel {
        let core = core, tokens = model.tokens, accountId = model.accountId
        return StakingActionModel(
            action: action,
            symbol: row.symbol,
            network: model.network,
            endpoints: model.endpoints,
            transport: rpc.transport,
            feeBalance: balances["STRK"],
            clock: model.clock,
            track: { [weak self] plan in self?.plans.append(plan) },
            prepare: {
                try core.prepareStaking(
                    accountId: accountId,
                    action: action,
                    staker: row.staker,
                    tokenId: row.tokenId,
                    amount: amount,
                    tokens: tokens
                )
            }
        )
    }
}
