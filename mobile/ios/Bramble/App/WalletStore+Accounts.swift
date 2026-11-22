import BrambleCore

/// Account management over the core (`docs/accounts.md` §3.3). The core owns every rule: names,
/// labels, groups, the network switch, and which index a new account takes. This layer only
/// refreshes the public records it renders and reports outcomes in the extension's words.
extension WalletStore {
    /// Re-reads records, groups, and the active account. With `ensure`, first runs the network
    /// switch rule so the selected network always has an active account.
    func reloadAccounts(ensure: Bool = false) async {
        let core = core, network = network
        do {
            let snapshot = try await work { () -> AccountsSnapshot in
                if ensure { _ = try core.ensureNetworkAccount(network: network) }
                return AccountsSnapshot(
                    records: try core.accountRecords(network: network),
                    allRecords: try core.allAccountRecords(),
                    groups: try core.accountGroups(),
                    active: try core.activeAccount()
                )
            }
            records = snapshot.records
            allRecords = snapshot.allRecords
            groups = snapshot.groups
            activeRecord = snapshot.active.flatMap { active in snapshot.records.first { $0.id == active.id } }
        } catch {
            toast = describe(error)
        }
    }

    /// This network's accounts the drawer, Send and Manage list (`hiddenAccountIds` left out).
    var visibleRecords: [AccountRecord] { records.filter { !$0.hidden } }

    /// This network's hidden accounts, which Manage lists with the control that shows them again.
    var hiddenRecords: [AccountRecord] { records.filter(\.hidden) }

    /// Hides or shows one account (`writeAccountVisibility`). The core refuses hiding the last
    /// account a network shows and moves the active account off one it hides; its refusal is the
    /// toast, as the extension shows the background's.
    func setHidden(_ hidden: Bool, for id: String) async {
        let core = core, before = activeRecord?.id
        do {
            try await work { try core.setAccountHidden(accountId: id, hidden: hidden) }
            await reloadAccounts()
            notify(hidden ? "Account hidden" : "Account shown")
            if activeRecord?.id != before { await refreshBalances(reset: true) }
        } catch {
            // Hiding the active account is two writes: the core may have moved the active account
            // before the hide failed. Re-read, so the app follows the core's active account.
            await reloadAccounts()
            if activeRecord?.id != before { await refreshBalances(reset: true) }
            toast = describe(error)
        }
    }

    /// The accounts the vault holds that mobile keeps but does not operate, for Manage's read-only
    /// section; empty when the read fails (the list only explains, it never gates anything).
    func unusableAccounts() async -> [UnusableAccount] {
        let core = core
        return (try? await work { try core.unusableAccounts() }) ?? []
    }

    /// Switches the active account (the drawer row is the switch control).
    func select(id: String) async {
        let core = core
        do {
            try await work { try core.selectAccount(accountId: id) }
            await reloadAccounts()
            await refreshBalances(reset: true)
        } catch { toast = describe(error) }
    }

    /// "Regular account": OpenZeppelin at the next free index, made active.
    func addRegularAccount() async throws {
        let core = core, network = network
        _ = try await work { try core.addRegularAccount(network: network) }
        scheduleIdleLock()
        await reloadAccounts()
        await refreshBalances(reset: true)
        notify("Account added")
    }

    /// Saves or clears (empty) the active account's name; toasts as `bindAccountLabel` does.
    func saveLabel(_ label: String, for id: String) async {
        let core = core
        do {
            let stored = try await work { try core.setAccountLabel(accountId: id, label: label) }
            await reloadAccounts()
            notify(stored == nil ? "Label cleared" : "Label saved")
        } catch { toast = "Label update failed" }
    }

    func createGroup(name: String, icon: String) async -> Bool {
        let core = core
        do {
            _ = try await work { try core.createAccountGroup(name: name, icon: icon) }
            await reloadAccounts()
            notify("Group created")
            return true
        } catch {
            toast = "Group create failed"
            return false
        }
    }

    func updateGroup(id: String, name: String, icon: String) async {
        let core = core
        do {
            _ = try await work { try core.updateAccountGroup(groupId: id, name: name, icon: icon) }
            await reloadAccounts()
            notify("Group updated")
        } catch { toast = "Group update failed" }
    }

    func deleteGroup(id: String) async {
        let core = core
        do {
            try await work { try core.deleteAccountGroup(groupId: id) }
            await reloadAccounts()
            notify("Group deleted")
        } catch { toast = "Group delete failed" }
    }

    /// Files an account into one folder, or none; toasts as the drawer picker does.
    func setGroup(_ groupId: String?, for accountId: String) async {
        let core = core
        do {
            try await work { try core.setAccountGroup(accountId: accountId, groupId: groupId) }
            await reloadAccounts()
            notify(groupId == nil ? "Removed from folder" : "Moved to folder")
        } catch { toast = "Group update failed" }
    }

    /// Toggles membership from a group's checklist (`bindGroupControls`).
    func toggleMember(_ accountId: String, of groupId: String) async {
        let member = groups.first { $0.id == groupId }?.accountIds.contains(accountId) ?? false
        let core = core
        do {
            try await work { try core.setAccountGroup(accountId: accountId, groupId: member ? nil : groupId) }
            await reloadAccounts()
            notify(member ? "Removed from group" : "Added to group")
        } catch { toast = "Group update failed" }
    }

    /// The network name for an account on the groups checklist.
    func networkName(of record: AccountRecord) -> String {
        supportedNetworks().first { $0.network == record.network }?.name ?? ""
    }
}

/// One consistent read of the account state, taken off the main actor.
struct AccountsSnapshot: Sendable {
    let records: [AccountRecord]
    let allRecords: [AccountRecord]
    let groups: [AccountGroup]
    let active: AccountRecord?
}
