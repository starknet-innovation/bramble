import BrambleCore
import Foundation

/// Private balances on top of `WalletStore`. Every decision is the core's (`shieldTile`,
/// `privateLine`, `receivePoolNotice`, `unifiedHomeBalances`, …): this file only gathers the public
/// facts the store already has and hands them over. See mobile/docs/privacy.md §2.
extension WalletStore {
    /// Whether the account holds STRK for fees (the core's `strkAvailableForFees`).
    enum StrkFunding {
        case funded
        case unfunded
    }

    /// `nil` until the public balances have loaded; the core takes it as `strkFunded: Bool?`.
    var strkFunding: StrkFunding? {
        guard !balances.isEmpty, let raw = balances["STRK"] else { return nil }
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "0")).isEmpty ? .unfunded : .funded
    }

    /// Re-reads the selected account's private balances; a result for an older scope is dropped.
    func refreshPrivacy() async {
        guard let account = activeRecord else {
            privacy.reset()
            portfolio.setPrivacy(reading: privacy.reading, state: privacy.state)
            return
        }
        await privacy.refresh(core: core, network: networkInfo, accountId: account.id, rpc: rpc.transport)
        // Private balances feed the portfolio's Home model (`unifiedHomeBalances`): rows and hero.
        portfolio.setPrivacy(reading: privacy.reading, state: privacy.state)
    }

    var shieldTileState: ShieldTile {
        shieldTile(
            network: network,
            deployment: deployment,
            strkFunded: strkFunding.map { $0 == .funded },
            reading: privacy.reading
        )
    }

    var poolNotice: PoolNotice {
        receivePoolNotice(
            deployment: deployment,
            strkFunded: strkFunding.map { $0 == .funded },
            reading: privacy.reading
        )
    }

    var privacyHeaderStatus: PrivacyStatus { privacyStatus(network: network, reading: privacy.reading) }

    func tokenDetailPrivacyFor(_ token: String) -> TokenDetailPrivacy {
        tokenDetailPrivacy(
            network: network,
            deployment: deployment,
            strkFunded: strkFunding.map { $0 == .funded },
            reading: privacy.reading,
            tokenAddress: token,
            state: privacy.state
        )
    }

    var includesShieldedBalances: Bool {
        shieldedBalancesIncluded(
            reading: privacy.reading,
            state: privacy.state,
            hiddenTokenAddresses: portfolio.hiddenTokenAddresses
        )
    }
}
