import BrambleCore

/// Ledger accounts into the vault (P8): a Ledger-only wallet at onboarding, or more Ledger accounts
/// beside the wallet's own. The core places every address from the request the picker read; this
/// layer only orders the calls and refreshes.
extension WalletStore {
    /// Creates a wallet with no recovery phrase from the first picked account, sealed under
    /// `password`, then adds the rest; the first stays active. Throws the core's refusal; a failure
    /// after the wallet exists leaves it with the accounts added so far.
    func createLedgerWallet(password: String, requests: [LedgerAccountRequest]) async throws {
        guard let first = requests.first else { return }
        let core = core
        do {
            try await work {
                let record = try core.createLedgerWallet(password: password, request: first)
                for request in requests.dropFirst() { _ = try core.addLedgerAccount(request: request) }
                if requests.count > 1 { try core.selectAccount(accountId: record.id) }
            }
        } catch {
            routeToUnlockIfLockedDuringCreation(error)
            throw error
        }
    }

    /// Adds the picked Ledger accounts to the unlocked wallet; the last one added is active, as
    /// each add makes its account active.
    func addLedgerAccounts(_ requests: [LedgerAccountRequest]) async throws {
        let core = core
        try await work {
            for request in requests { _ = try core.addLedgerAccount(request: request) }
        }
        scheduleIdleLock()
        await reloadAccounts()
        await refreshBalances(reset: true)
        notify(requests.count == 1 ? "Account added" : "\(requests.count) accounts added")
    }

    /// Whether the unlocked wallet has a recovery phrase; a Ledger-only wallet has none and hides
    /// what needs one. True when the core cannot say, so nothing is hidden by a failed read.
    var hasRecoveryPhrase: Bool {
        (try? core.hasRecoveryPhrase()) ?? true
    }

    /// Addresses on the selected network, so the picker shows which accounts are already here.
    var heldAddresses: Set<String> {
        Set(records.map(\.address))
    }
}
