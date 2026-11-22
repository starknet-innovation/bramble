import BrambleCore

/// `network`'s record as every RPC read and send uses it: the core's `networks()`, which puts the
/// wallet's custom RPC endpoint (Settings → Network → RPC endpoint) before the bundled ones, as the
/// extension's `networkRpcUrls`. Before a wallet exists, or while it is locked, the core holds no
/// readable override and refuses `networks()`; the bundled record is used then (onboarding has no
/// override to honour, and no account read runs while locked). Never log the result: an override
/// URL may carry an API key.
func endpointNetwork(_ network: NetworkId, wallet: WalletCore) -> NetworkInfo {
    let records = (try? wallet.networks()) ?? supportedNetworks()
    guard let info = records.first(where: { $0.network == network }) else {
        preconditionFailure("the core supports every NetworkId")
    }
    return info
}
