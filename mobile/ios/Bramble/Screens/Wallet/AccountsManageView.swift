import BrambleCore
import SwiftUI

/// "Accounts & groups" (`accountFlow` in `flows.ts`): pick an account (each row with its inline
/// address copy), add one, organise groups, then name the active account and inspect its
/// identifiers as a receipt with copy controls, top to bottom: pick → organise → inspect.
struct AccountsManageView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @State private var choosing = false
    @State private var label = ""
    @State private var labelResult: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BrambleSpace.md) {
                FlowHeader(title: "Accounts & groups", network: store.networkLabel) { dismiss() }
                Eyebrow(text: "Accounts")
                MenuGroup {
                    ForEach(store.records, id: \.id) { record in accountRow(record) }
                    MenuRow(icon: .plus, title: "Add account", chevron: false) { choosing = true }
                }
                if store.records.isEmpty {
                    StatusLine(text: "No accounts on this network yet. Add one below.")
                }
                GroupsSection()
                if let active = store.activeRecord { activeSection(active) }
            }
            .padding(.horizontal, BrambleSpace.lg)
            .padding(.bottom, BrambleSpace.xl)
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $choosing) {
            SkinProvider {
                AddAccountChooser(close: { choosing = false }, added: { choosing = false })
                    .padding(BrambleSpace.xl)
                    .background { SheetBackground() }
                    .presentationDetents([.medium])
            }
            .environment(store)
        }
        .onAppear { label = store.activeRecord?.label ?? "" }
        .onChange(of: store.activeRecord?.id) { _, _ in
            label = store.activeRecord?.label ?? ""
            labelResult = nil
        }
    }

    private func accountRow(_ record: AccountRecord) -> some View {
        let selected = record.id == store.activeRecord?.id
        let group = store.groups.first { $0.id == record.groupId }
        return HStack(spacing: 0) {
            Button { Task { await store.select(id: record.id) } } label: {
                HStack(spacing: BrambleSpace.md) {
                    AccountAvatarView(address: record.address)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(record.displayName).brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold).lineLimit(1)
                            if let group {
                                BrambleIcon(groupIcon(group.icon), size: 14).foregroundStyle(skin.muted)
                                    .accessibilityLabel("Groups: \(group.name)")
                            }
                        }
                        Text(record.shortAddress)
                            .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold, mono: true)
                            .foregroundStyle(skin.muted)
                    }
                    Spacer(minLength: 0)
                    if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
                }
                .padding(.leading, BrambleSpace.lg)
                .padding(.trailing, BrambleSpace.sm)
                .frame(minHeight: 64)
            }
            .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: Rectangle(), scale: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(record.displayName)
            .accessibilityValue(record.address)
            .accessibilityAddTraits(selected ? .isSelected : [])
            CopyButton(value: record.address, label: "Copy \(record.displayName) address")
                .padding(.trailing, BrambleSpace.sm)
        }
    }

    private func activeSection(_ active: AccountRecord) -> some View {
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            Eyebrow(text: "Active account").padding(.top, BrambleSpace.sm)
            BrambleField(label: "Name", placeholder: active.shortAddress, text: $label,
                         hint: "Shown instead of the address. Leave empty to clear.")
                .onChange(of: label) { _, next in
                    if next.utf16.count > 64 { label = String(next.prefix(64)) }
                }
            PillButton("Save name", kind: .secondary, icon: .check) {
                Task {
                    await store.saveLabel(label, for: active.id)
                    labelResult = store.toastTone == .error ? store.toast : nil
                }
            }
            StatusLine(text: labelResult, tone: .danger)
            MenuGroup {
                ReceiptRow(label: "Address", value: active.shortAddress, copy: active.address, copyLabel: "Copy address")
                ReceiptRow(label: "Signer public key", value: accountLabel(address: active.publicKey), copy: active.publicKey, copyLabel: "Copy signer public key")
                ReceiptRow(label: "Class hash", value: accountLabel(address: active.classHash), copy: active.classHash, copyLabel: "Copy class hash")
                if let type = active.typeLabel {
                    ReceiptRow(label: "Type", value: type)
                }
            }
        }
    }
}

/// One `receipt()` line: a muted label, the (truncated) value, and an optional copy action that
/// always copies the full value.
struct ReceiptRow: View {
    @Environment(\.skin) private var skin
    let label: String
    let value: String
    var copy: String?
    var copyLabel: String?

    var body: some View {
        HStack(spacing: BrambleSpace.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
                Text(value).brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium, mono: copy != nil)
            }
            Spacer(minLength: 0)
            if let copy, let copyLabel {
                CopyButton(value: copy, label: copyLabel)
            }
        }
        .padding(.leading, BrambleSpace.lg)
        .padding(.trailing, BrambleSpace.sm)
        .frame(minHeight: 56)
        .accessibilityElement(children: .contain)
    }
}

/// The panel fill behind a sheet, matching the drawer.
struct SheetBackground: View {
    @Environment(\.skin) private var skin
    var body: some View { skin.panel.ignoresSafeArea() }
}
