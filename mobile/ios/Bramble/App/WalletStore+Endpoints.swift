import BrambleCore

extension WalletStore {
    /// `setRpcOverride` for `network`: the core trims `raw` and clears the override when it is
    /// empty; returns what is stored. The portfolio's scope holds the endpoint list it was entered
    /// with, so a change to the network on screen enters it again: no read goes to the old
    /// endpoints after the save, as none does in the extension, which re-renders at once.
    func saveRpcOverride(_ raw: String, for network: NetworkId) async throws -> String? {
        let core = core
        let saved = try await work { try core.setRpcOverride(network: network, rpcUrl: raw) }
        if network == self.network { await refreshBalances(reset: true) }
        return saved
    }
}
