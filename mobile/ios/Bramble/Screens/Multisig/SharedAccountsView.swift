import BrambleCore
import SwiftUI

/// `multisigDisplayName`: the saved name, else the shortened address.
func multisigDisplayName(_ record: MultisigRecord) -> String {
    record.name ?? shortKey(value: record.address)
}

/// The stored-view label (`configLabel` over `storedMultisigView`): threshold and signer count from
/// `currentConfig`, the deployment setup, or the last chain read; otherwise unavailable. Mobile
/// cannot detect non-Stark signers yet, so it never shows the extension's " · Watch only".
func multisigConfigLabel(_ record: MultisigRecord) -> String {
    guard let threshold = record.threshold else { return "Authority unavailable" }
    return "\(threshold) of \(record.signerCount) signers"
}

/// `multisigs` (`journeys/multisig/multisig-views.ts`): the two setup actions and every shared
/// account saved on the active network.
struct SharedAccountsView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openCoordinationFlow) private var open

    private var records: [MultisigRecord] { store.coordination.multisigs }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                FlowHeader(title: "Shared accounts", subtitle: "\(records.count) account\(records.count == 1 ? "" : "s")",
                           network: store.networkLabel) { dismiss() }
                MenuGroup {
                    MenuRow(icon: .plus, title: "Add shared account") { open(.addShared) }
                    MenuRow(icon: .users, title: "Create a multisig") { open(.createMultisig(resume: nil)) }
                }
                Eyebrow(text: "Shared accounts").padding(.top, BrambleSpace.sm)
                if records.isEmpty {
                    Text("No shared accounts are saved on this network yet.")
                        .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                } else {
                    MenuGroup {
                        ForEach(records, id: \.id) { record in
                            Button { open(.sharedAccount(id: record.id)) } label: { row(record) }
                                .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous), scale: 1))
                                .accessibilityLabel(multisigDisplayName(record))
                                .accessibilityValue(multisigConfigLabel(record))
                        }
                    }
                }
            }
            .padding(.horizontal, BrambleSpace.lg)
        }
        .task { await store.coordination.refresh() }
    }

    private func row(_ record: MultisigRecord) -> some View {
        HStack(spacing: BrambleSpace.sm) {
            BrambleIcon(.wallet, size: 20).foregroundStyle(skin.muted).frame(width: 28, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(multisigDisplayName(record)).brambleText(BrambleTypeScale.row, weight: BrambleWeight.medium).foregroundStyle(skin.text)
                Text(multisigConfigLabel(record)).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
            }
            Spacer(minLength: BrambleSpace.sm)
            BrambleIcon(.chevronRight).foregroundStyle(skin.muted)
        }
        .padding(.horizontal, BrambleSpace.lg)
        .frame(minHeight: BrambleSize.row)
    }
}

/// `multisig-add`: the Ready Multisig gateway, for an "add account" entry point.
struct ReadyMultisigView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openCoordinationFlow) private var open

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            FlowHeader(title: "Ready Multisig", subtitle: "Multiple signers approve together", network: store.networkLabel) { dismiss() }
            OptionCard(icon: .users, title: "Create a multisig", detail: "Set participants, fund, and deploy.") { open(.createMultisig(resume: nil)) }
            OptionCard(icon: .search, title: "Add a shared address", detail: "Sync it or resume setup.") { open(.addShared) }
            Spacer()
        }
        .padding(.horizontal, BrambleSpace.lg)
    }
}

/// `multisig-watch`: add a shared account by address. A deployed account's authority is read at
/// one pinned block; an undeployed one is saved by address alone.
struct AddSharedAccountView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var result: String?
    @State private var failed = false
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            FlowHeader(title: "Add shared account", subtitle: "Sync or resume a Ready multisig", network: store.networkLabel) { dismiss() }
            BrambleField(label: "Multisig address", placeholder: "0x…", text: $address, mono: true,
                         hint: "If deployed, signer authority syncs from Starknet. If not, the address is saved and deployment setup is verified before use.")
            PillButton("Add shared account", busy: busy) { add() }
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
            StatusLine(text: result, tone: failed ? .danger : .positive)
            Spacer()
        }
        .padding(.horizontal, BrambleSpace.lg)
    }

    private func add() {
        busy = true
        Task {
            defer { busy = false }
            do {
                result = try await store.coordination.addShared(address: address)
                failed = false
            } catch {
                failed = true
                result = (error as? CoordinationStore.Refusal)?.message ?? describe(error)
                store.toast = result
            }
        }
    }
}
