import BrambleCore
import SwiftUI

/// The account drawer (`account-drawer.ts`): title with the network, folder filter chips when any
/// group exists, this network's accounts (the selected one on accent-soft with a check, each with
/// its folder button and inline picker), then "Add account" and "Manage accounts & groups".
/// As in the extension, rows carry no copy control: the row is the switch, and the full, copyable
/// identifiers live one tap away on Manage.
struct AccountsSheet: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    let openManage: () -> Void
    @State private var groupFilter: String?
    @State private var openAssignId: String?
    @State private var choosing = false

    var body: some View {
        Group {
            if choosing {
                AddAccountChooser(close: { choosing = false }, added: { dismiss() })
            } else {
                drawer
            }
        }
        .padding(BrambleSpace.xl)
        .background(skin.panel.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(BrambleRadius.xl)
        .animation(BrambleEase.out.animation(ms: BrambleMotion.drawerMs), value: choosing)
    }

    private var activeGroup: AccountGroup? {
        groupFilter.flatMap { id in store.groups.first { $0.id == id } }
    }

    private var visible: [AccountRecord] {
        guard let activeGroup else { return store.records }
        return store.records.filter { activeGroup.accountIds.contains($0.id) }
    }

    private var drawer: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.lg) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Accounts").brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                    Text(store.networkInfo.name).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                }
                Spacer()
                IconButton(icon: .x, label: "Close accounts", tint: skin.muted) { dismiss() }
            }
            if !store.groups.isEmpty { chips }
            ScrollView {
                if visible.isEmpty {
                    Text(activeGroup == nil
                         ? "No accounts on this network yet. Add one below."
                         : "No accounts in this group yet. Open an account's folder button to add it.")
                        .brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(spacing: BrambleSpace.xs) {
                        ForEach(visible, id: \.id) { record in row(record) }
                    }
                }
            }
            VStack(spacing: BrambleSpace.sm) {
                PillButton("Add account", kind: .secondary, icon: .plus) { choosing = true }
                MenuGroup {
                    MenuRow(icon: .settings, title: "Manage accounts & groups") {
                        dismiss()
                        openManage()
                    }
                }
            }
        }
    }

    /// `.group-chips`: "All" then one chip per group, the selected one pressed.
    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: BrambleSpace.xs) {
                chip(nil, "All", .wallet)
                ForEach(store.groups, id: \.id) { group in chip(group.id, group.name, groupIcon(group.icon)) }
            }
        }
        .accessibilityLabel("Filter by group")
    }

    private func chip(_ id: String?, _ label: String, _ icon: BrambleIconName) -> some View {
        let selected = groupFilter == id
        return Button { groupFilter = id } label: {
            HStack(spacing: 6) {
                BrambleIcon(icon, size: 16)
                Text(label).brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
            }
            .foregroundStyle(selected ? skin.text : skin.muted)
            .padding(.horizontal, BrambleSpace.md)
            .frame(height: BrambleSize.pill + 8)
        }
        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : skin.elevated, pressed: skin.softPress, shape: Capsule(), scale: 0.96))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func row(_ record: AccountRecord) -> some View {
        let selected = record.id == store.activeRecord?.id
        let folder = store.groups.first { $0.id == record.groupId }
        let pickerLabel = folder.map { "Folder: \($0.name)" } ?? "No folder — choose one"
        return VStack(spacing: BrambleSpace.xs) {
            HStack(spacing: BrambleSpace.xs) {
                Button {
                    Task { await store.select(id: record.id) }
                    dismiss()
                } label: {
                    HStack(spacing: BrambleSpace.md) {
                        AccountAvatarView(address: record.address)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.displayName).brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold).lineLimit(1)
                            Text(record.shortAddress)
                                .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold, mono: true)
                                .foregroundStyle(skin.muted)
                        }
                        Spacer(minLength: 0)
                        if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
                    }
                    .padding(.horizontal, BrambleSpace.sm)
                    .frame(minHeight: BrambleSize.row)
                }
                .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: BrambleRadius.lg, style: .continuous), scale: 1))
                .accessibilityElement(children: .combine)
                .accessibilityLabel(record.displayName)
                .accessibilityValue(record.address)
                .accessibilityAddTraits(selected ? .isSelected : [])
                IconButton(icon: folder.map { groupIcon($0.icon) } ?? .folder,
                           label: "\(pickerLabel) for \(record.displayName)",
                           tint: folder == nil ? skin.muted : skin.text) {
                    openAssignId = openAssignId == record.id ? nil : record.id
                }
            }
            if openAssignId == record.id {
                FolderPicker(record: record, current: folder?.id) { openAssignId = nil }
            }
        }
    }
}

/// `groupPickerPanel`: a single-select list of the groups plus "None", the current one checked.
struct FolderPicker: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let record: AccountRecord
    let current: String?
    let done: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if store.groups.isEmpty {
                Text("No groups yet. Create one in Manage accounts & groups.")
                    .brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(BrambleSpace.md)
            }
            ForEach(store.groups, id: \.id) { group in
                option(group.id, group.name, groupIcon(group.icon))
            }
            if !store.groups.isEmpty { option(nil, "None", .folder) }
        }
        .background(skin.elevated, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
        .accessibilityLabel("Choose a folder")
    }

    private func option(_ id: String?, _ name: String, _ icon: BrambleIconName) -> some View {
        let selected = id == current
        return Button {
            Task {
                await store.setGroup(id, for: record.id)
                done()
            }
        } label: {
            HStack(spacing: BrambleSpace.sm) {
                BrambleIcon(icon, size: 18).foregroundStyle(skin.muted)
                Text(name).brambleText(BrambleTypeScale.body, weight: BrambleWeight.medium)
                Spacer(minLength: 0)
                if selected { BrambleIcon(.check, size: 18).foregroundStyle(skin.accent) }
            }
            .padding(.horizontal, BrambleSpace.md)
            .frame(minHeight: 44)
        }
        .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Rectangle(), scale: 1))
        .accessibilityIdentifier("folder-option-\(id ?? "none")")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// `addAccountChooser`: "Add a new account" with the options this app offers today. Ledger and
/// multisig are left out (other workstreams); importing is shown as coming, like onboarding does.
struct AddAccountChooser: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let close: () -> Void
    let added: () -> Void
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.lg) {
            HStack {
                Text("Add a new account").brambleText(BrambleTypeScale.display, weight: BrambleWeight.bold, tracking: BrambleTracking.display)
                Spacer()
                IconButton(icon: .x, label: "Close Add account", tint: skin.muted, action: close)
            }
            VStack(spacing: BrambleSpace.md) {
                OptionCard(icon: .wallet, title: "Regular account", detail: "Create the next account from this wallet’s recovery phrase.") {
                    guard !busy else { return }
                    busy = true
                    Task {
                        do {
                            try await store.addRegularAccount()
                            added()
                        } catch { store.toast = describe(error) }
                        busy = false
                    }
                }
                OptionCard(icon: .link, title: "Import an existing account", detail: "Coming to Bramble mobile.") {}
                    .disabled(true)
            }
            Spacer(minLength: 0)
        }
    }
}

/// A group's icon name (`GROUP_ICONS`) as the bundled glyph; every group icon ships in the set.
func groupIcon(_ name: String) -> BrambleIconName {
    BrambleIconName(rawValue: "Icons/\(name)") ?? .folder
}
