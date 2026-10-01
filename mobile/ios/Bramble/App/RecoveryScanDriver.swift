import BrambleCore
import Observation

/// Runs "Find your accounts" (`recovery-account-ui.ts`) over the core's sans-IO scan: asks the
/// core for bodies, moves them through a transport, hands the answers back, and keeps the user's
/// picks. The core derives every address and judges every answer; this type holds no secret and
/// never supplies an address to restore, only `(family, index, class)` coordinates.
@MainActor
@Observable
final class RecoveryScanDriver {
    private(set) var candidates: [RecoveryCandidate] = []
    private(set) var status = "Ready to search."
    private(set) var complete = false
    private(set) var scanning = false
    private(set) var failed = false
    private(set) var selected: Set<String> = []
    private var seen: Set<String> = []
    private var generation = 0
    private let core: WalletCore
    private let rpc: RpcClient
    private let limits = recoveryLimits()

    init(core: WalletCore, rpc: RpcClient) {
        self.core = core
        self.rpc = rpc
    }

    /// Starts a fresh search, dropping earlier results and picks (`start()`).
    func start(on network: NetworkInfo) async {
        generation += 1
        candidates = []
        complete = false
        selected = []
        seen = []
        core.recoveryScanReset()
        status = "Searching every account type…"
        await scan(on: network, manual: nil)
    }

    /// Stops applying results from a scan in flight (the screen went away or the app locked).
    func cancel() {
        generation += 1
        scanning = false
    }

    /// Runs the default scan to completion, or checks one manual index.
    func scan(on network: NetworkInfo, manual: UInt32?) async {
        guard !scanning else { return }
        scanning = true
        failed = false
        let active = generation
        let walletCore = core, client = rpc, id = network.network
        defer { if active == generation { scanning = false } }
        do {
            repeat {
                var step = try await Task.detached {
                    try walletCore.recoveryScanNext(network: id, manualIndex: manual)
                }.value
                while !step.requests.isEmpty {
                    let responses = try await client.send(step.requests, on: network)
                    step = try await Task.detached { try walletCore.recoveryScanSubmit(responses: responses) }.value
                }
                guard active == generation else { return }
                apply(step)
            } while manual == nil && !complete
        } catch {
            guard active == generation else { return }
            failed = true
            status = "Account search paused. Check the network and retry."
        }
    }

    private func apply(_ step: RecoveryScanStep) {
        for candidate in step.candidates where !seen.contains(candidate.key) {
            if candidate.autoSelect { _ = trySelect(candidate.key) }
            seen.insert(candidate.key)
        }
        candidates = step.candidates
        complete = step.complete
        status = step.status
    }

    private func trySelect(_ key: String) -> Bool {
        if selected.contains(key) { return true }
        guard selected.count < Int(limits.maxSelections) else { return false }
        selected.insert(key)
        return true
    }

    /// Checks or unchecks one row; false when the 40-account bound refuses it.
    func toggle(_ candidate: RecoveryCandidate) -> Bool {
        if selected.contains(candidate.key) {
            selected.remove(candidate.key)
            return true
        }
        return candidate.selectable && trySelect(candidate.key)
    }

    /// The bound note the extension appends to the status once 40 are picked and more wait.
    var selectionNote: String {
        guard selected.count >= Int(limits.maxSelections) else { return "" }
        let waiting = candidates.contains { ($0.deployed || $0.funded) && !selected.contains($0.key) }
        guard waiting else { return "" }
        return " At most \(limits.maxSelections) accounts can be restored at once."
            + " Uncheck one to choose another."
    }

    /// The picked rows as restore coordinates; the class travels with every non-OZ pick.
    var selections: [RecoverySelection] {
        candidates.filter { selected.contains($0.key) }.map { candidate in
            RecoverySelection(
                family: candidate.family,
                accountIndex: candidate.accountIndex,
                classHash: candidate.family == .openZeppelin ? nil : candidate.classHash
            )
        }
    }

    /// Commits the picks in one vault write; returns how many were restored.
    func restore(on network: NetworkId) async throws -> Int {
        let walletCore = core, picks = selections
        let restored = try await Task.detached {
            try walletCore.restoreRecoveredAccounts(network: network, selections: picks)
        }.value
        return restored.count
    }
}
