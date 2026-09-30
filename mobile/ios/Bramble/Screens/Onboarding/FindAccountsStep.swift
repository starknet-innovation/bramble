import BrambleCore
import SwiftUI

/// `data-onboarding-step="recovery-accounts"`: the first 20 indices searched for Bramble, Ready,
/// and Braavos accounts, active ones selected, an advanced manual index, and one atomic restore.
/// Restore needs only a selection (`refreshGate`): the extension dropped the Mainnet
/// acknowledgement that used to gate it.
///
/// **Decision:** no "Back to passphrase". Mobile seals the vault at the passphrase step (with
/// recovery pending) so a kill or lock resumes here; there is no earlier step to return to.
struct FindAccountsStep: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.scenePhase) private var phase
    let done: () -> Void
    @State private var driver: RecoveryScanDriver?
    @State private var manualIndex = ""
    @State private var result: String?
    @State private var restoring = false
    @State private var opened: Set<AccountFamily> = []

    private static let lede = "Bramble checks the first 20 account indices for Bramble, Ready, and Braavos accounts. "
        + "Accounts with on-chain activity are selected automatically."

    var body: some View {
        OnboardingStep(icon: .wallet, title: "Find your accounts", lede: Self.lede) {
            VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
                HStack(spacing: BrambleSpace.sm) {
                    StatusLine(
                        text: (driver?.status ?? "Ready to search.") + (driver?.selectionNote ?? ""),
                        tone: driver?.failed == true ? .danger : .muted
                    )
                    .accessibilityIdentifier("recovery-scan-status")
                    IconButton(icon: .refresh, label: "Retry account search", tint: skin.muted) {
                        Task { await driver?.start(on: store.networkInfo) }
                    }
                    .disabled(driver?.scanning == true)
                }
                StatusLine(
                    text: "The search asks \(store.networkInfo.name)’s RPC endpoint about each derived address."
                )
                group(.openZeppelin, "Bramble accounts")
                group(.argent, "Ready accounts")
                group(.braavos, "Braavos accounts")
                Disclosure(title: "Advanced manual index", isOpen: $manualOpen) { manual }
                StatusLine(text: result)
            }
        } cta: {
            PillButton("Restore selected accounts", busy: restoring) { restore() }
                .disabled((driver?.selected.isEmpty ?? true) || driver?.scanning == true)
        }
        .task {
            guard driver == nil else { return }
            let next = RecoveryScanDriver(core: store.core, rpc: store.rpc)
            driver = next
            await next.start(on: store.networkInfo)
        }
        .onChange(of: phase) { _, next in if next == .background { driver?.cancel() } }
        .onDisappear { driver?.cancel() }
    }

    private func rows(_ family: AccountFamily) -> [RecoveryCandidate] {
        (driver?.candidates ?? [])
            .filter { $0.family == family }
            .enumerated()
            .sorted { ($0.element.accountIndex, $0.offset) < ($1.element.accountIndex, $1.offset) }
            .map(\.element)
    }

    /// One family's disclosure; it opens itself the first time it has a detected account.
    private func group(_ family: AccountFamily, _ title: String) -> some View {
        let rows = rows(family)
        let detected = rows.filter { $0.deployed || $0.funded }.count
        let isOpen = Binding(
            get: { opened.contains(family) },
            set: { if $0 { opened.insert(family) } else { opened.remove(family) } }
        )
        let summary = detected > 0 ? "\(detected) \(detected == 1 ? "account" : "accounts") detected" : nil
        return Disclosure(title: title, summary: summary, isOpen: isOpen) {
            VStack(alignment: .leading, spacing: BrambleSpace.xs) {
                ForEach(rows, id: \.key) { candidate in CandidateRow(candidate: candidate, driver: driver) }
            }
        }
        .onChange(of: detected) { _, count in
            if count > 0, !opened.contains(family) { opened.insert(family) }
        }
    }

    @State private var manualOpen = false

    private var manual: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
            BrambleField(label: "Account index", placeholder: "0", text: $manualIndex)
                .keyboardType(.numberPad)
            PillButton("Check this index", kind: .secondary) {
                guard let index = UInt32(manualIndex), index <= recoveryLimits().maxIndex else {
                    store.toast = "Enter a valid non-negative account index"
                    return
                }
                Task { await driver?.scan(on: store.networkInfo, manual: index) }
            }
            .disabled(driver?.scanning == true)
        }
    }

    private func restore() {
        guard let driver, !driver.selected.isEmpty else { return }
        restoring = true
        result = "Restoring the selected accounts into your encrypted vault…"
        Task {
            do {
                let count = try await driver.restore(on: store.network)
                store.notify("\(count) account\(count == 1 ? "" : "s") restored")
                done()
            } catch {
                result = "Account recovery failed"
                store.toast = "Account recovery failed"
                restoring = false
            }
        }
    }
}

/// `.select-row`: a checkbox, the row title, the truncated address in mono, and the hint.
private struct CandidateRow: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let candidate: RecoveryCandidate
    let driver: RecoveryScanDriver?

    private enum Layout {
        /// Drops the checkbox to the title's first baseline.
        static let checkBoxTop: CGFloat = 2
        static let copyGap: CGFloat = 2
        /// A row that cannot be selected is shown dimmed.
        static let unselectableOpacity = 0.5
    }

    var body: some View {
        let checked = driver?.selected.contains(candidate.key) == true
        Button {
            guard let driver, driver.toggle(candidate) == false else { return }
            store.toast = "Choose at most \(recoveryLimits().maxSelections) accounts. Uncheck one to add another."
        } label: {
            HStack(alignment: .top, spacing: BrambleSpace.sm) {
                CheckBox(isOn: checked).padding(.top, Layout.checkBoxTop)
                VStack(alignment: .leading, spacing: Layout.copyGap) {
                    Text(candidate.title).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold)
                    Text(candidate.shortAddress)
                        .brambleText(BrambleTypeScale.caption, mono: true)
                        .foregroundStyle(skin.muted)
                    Text(candidate.hint).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, BrambleSpace.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!candidate.selectable)
        .opacity(candidate.selectable ? 1 : Layout.unselectableOpacity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(candidate.title), \(candidate.shortAddress)")
        .accessibilityValue(candidate.hint)
        .accessibilityAddTraits(checked ? [.isButton, .isSelected] : .isButton)
    }
}
