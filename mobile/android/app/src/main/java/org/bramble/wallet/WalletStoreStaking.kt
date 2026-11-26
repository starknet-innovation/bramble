package org.bramble.wallet

import org.bramble.core.StakingAction
import org.bramble.core.StakingRowView
import org.bramble.core.validateRecipient
import org.bramble.wallet.staking.StakingActionModel
import org.bramble.wallet.staking.StakingModel
import org.bramble.wallet.staking.stakingRefusal

// Staking (M21) on [WalletStore], twin of the iOS `WalletStore+Staking.swift`. Whether staking
// shows at all is the core's `STAKING_POLICY` (Mainnet only), asked through [stakingRefusal],
// never a network check here. Main-thread only, like the store.

private const val MS_PER_SECOND = 1_000

/** True where the core offers staking on the selected network and an account is open. */
val WalletStore.stakingAvailable: Boolean
    get() = activeRecord != null && stakingRefusal(network) == null

/**
 * Stake on the token screen: STRK only, compared by address, where staking is available. The
 * extension's `canStakeToken` also offers any token a loaded staking row lists; the token screen
 * has no staking rows loaded, so this offers STRK alone.
 */
fun WalletStore.canStake(tokenAddress: String): Boolean {
    val strk = networkInfo.tokens.firstOrNull { it.symbol == "STRK" }?.let { validateRecipient(it.address) }
    return stakingAvailable && strk != null && validateRecipient(tokenAddress) == strk
}

/** The staking screen for the active account, or null while locked. */
fun WalletStore.makeStakingModel(): StakingModel? {
    val account = activeRecord ?: return null
    val clock = portfolio.clock
    return StakingModel(
        walletCore,
        networkInfo,
        account.id,
        portfolio.preferences,
        portfolio.reads,
    ) { (clock() / MS_PER_SECOND).toULong() }
}

/**
 * [action] on [row]'s pool (validator and token) with the [amount] typed, for the account [model]
 * was opened for. Its plan is tracked, so a lock cancels it.
 */
fun WalletStore.makeStakingAction(
    action: StakingAction,
    row: StakingRowView,
    amount: String?,
    model: StakingModel,
): StakingActionModel = StakingActionModel(this, model, action, row, amount)
