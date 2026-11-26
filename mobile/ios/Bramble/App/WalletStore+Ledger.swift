import BrambleCore

/// Ledger accounts into the vault (P8): a Ledger-only wallet at onboarding, or more Ledger accounts
/// beside the wallet's own. The core places every address from the request the picker read; this
/// layer only orders the calls and refreshes.
extension WalletStore {
    /// Creates a wallet with no recovery phrase from the first picked account, sealed under
    /// `password`, then adds the rest; the first stays active. Throws `LedgerWalletError` for no
    /// picks, and the core's refusal when the wallet was not created. Once it exists the wallet
    /// counts as created: a later pick that fails to add is shown as an error toast, never thrown,
    /// so onboarding moves on and a retry never meets "a wallet already exists".
    func createLedgerWallet(password: String, requests: [LedgerAccountRequest]) async throws {
        guard let first = requests.first else { throw LedgerWalletError.noAccounts }
        let core = core
        let failed: Int
        do {
            failed = try await work {
                let record = try core.createLedgerWallet(password: password, request: first)
                let refused = requests.dropFirst().filter { (try? core.addLedgerAccount(request: $0)) == nil }.count
                if requests.count > 1 { try? core.selectAccount(accountId: record.id) }
                return refused
            }
        } catch {
            routeToUnlockIfLockedDuringCreation(error)
            throw error
        }
        if failed > 0 { toast = Self.ledgerNotAdded(failed) }
    }

    /// The toast after onboarding for `count` picks the core refused to add.
    static func ledgerNotAdded(_ count: Int) -> String {
        count == 1 ? "1 account wasn't added. Add it from Add account."
            : "\(count) accounts weren't added. Add them from Add account."
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

/// Why a Ledger wallet was not created before the core was asked.
enum LedgerWalletError: Error {
    /// No account was picked.
    case noAccounts
}
