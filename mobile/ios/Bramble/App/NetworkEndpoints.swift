import BrambleCore

/// `network`'s record as every RPC read and send uses it: the core's `networks()`, which puts the
/// wallet's custom RPC endpoint (Settings → Network → RPC endpoint) before the bundled ones, as the
/// extension's `networkRpcUrls`. Before a wallet exists the bundled record is used (onboarding has
/// no override to honour). With a wallet whose session is gone (the core's idle lock can land just
/// before the app's), the override is unreadable, so the record has no endpoints and every read
/// fails closed rather than sending the account to the bundled providers. Never log the result:
/// an override URL may carry an API key.
func endpointNetwork(_ network: NetworkId, wallet: WalletCore) -> NetworkInfo {
    endpointNetwork(network) { try wallet.networks() }
}

/// `endpointNetwork` over the wallet's answer, so the choice is testable for each refusal.
func endpointNetwork(_ network: NetworkId, wallet: () throws -> [NetworkInfo]) -> NetworkInfo {
    let records: [NetworkInfo]
    var failClosed = false
    do {
        records = try wallet()
    } catch CoreError.NoWallet {
        records = supportedNetworks()
    } catch {
        records = supportedNetworks()
        failClosed = true
    }
    guard var info = records.first(where: { $0.network == network }) else {
        preconditionFailure("the core supports every NetworkId")
    }
    if failClosed { info.rpcUrls = [] }
    return info
}
