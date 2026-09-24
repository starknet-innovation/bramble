import BrambleCore
import Foundation

/// Private balances on top of `WalletStore`. Every decision is the core's (`shieldTile`,
/// `privateLine`, `receivePoolNotice`, `unifiedHomeBalances`, …): this file only gathers the public
/// facts the store already has and hands them over. See mobile/docs/privacy.md §2.
extension WalletStore {
    /// `strkAvailableForFees`: `nil` until the public balances have loaded.
    var strkFunded: Bool? {
        guard !balances.isEmpty, let raw = balances["STRK"] else { return nil }
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "0")) != ""
    }

    /// Re-reads the selected account's private balances; a result for an older scope is dropped.
    func refreshPrivacy() async {
        guard let account else {
            privacy.reset()
            return
        }
        await privacy.refresh(core: core, network: networkInfo, accountIndex: account.index, rpc: rpc.transport)
    }

    var shieldTileState: ShieldTile {
        shieldTile(network: network, deployment: deployment, strkFunded: strkFunded, reading: privacy.reading)
    }

    var poolNotice: PoolNotice {
        receivePoolNotice(deployment: deployment, strkFunded: strkFunded, reading: privacy.reading)
    }

    var privacyHeaderStatus: PrivacyStatus { privacyStatus(network: network, reading: privacy.reading) }

    func privateLineFor(_ token: String) -> PrivateLine {
        privateLine(network: network, deployment: deployment, strkFunded: strkFunded, reading: privacy.reading, tokenAddress: token, state: privacy.state)
    }

    func tokenDetailPrivacyFor(_ token: String) -> TokenDetailPrivacy {
        tokenDetailPrivacy(network: network, deployment: deployment, strkFunded: strkFunded, reading: privacy.reading, tokenAddress: token, state: privacy.state)
    }

    /// Home rows with private value summed in; empty until the public balances have loaded.
    var unifiedRows: [UnifiedBalance] {
        guard !balances.isEmpty else { return [] }
        let loaded = networkInfo.tokens.compactMap { token in
            balances[token.symbol].map { PublicBalance(tokenAddress: token.address, balance: $0) }
        }
        return unifiedHomeBalances(network: network, publicBalances: loaded, hiddenTokenAddresses: [], reading: privacy.reading, state: privacy.state)
    }

    var includesShieldedBalances: Bool {
        shieldedBalancesIncluded(reading: privacy.reading, state: privacy.state, hiddenTokenAddresses: [])
    }
}
