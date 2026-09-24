import BrambleCore
import SwiftUI

/// The account drawer (`account-drawer.ts`): title with the network, folder filter chips when any
/// group exists, this network's accounts (the selected one on accent-soft with a check, each with
/// its folder button and inline picker), then "Add account" and "Manage accounts & groups".
/// As in the extension, rows carry no copy control: the row is the switch, and the full, copyable
/// identifiers live one tap away on Manage. On a phone the extension's left drawer is a system
/// bottom sheet with medium/large detents (an intentional platform difference); its row metrics
/// are the drawer's (`BrambleMetrics.Drawer`).
struct AccountsSheet: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
        .padding(BrambleMetrics.Drawer.padding)
        .padding(.top, BrambleSpace.sm)
        .background(skin.panel.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(BrambleRadius.xl)
        .presentationBackground(skin.panel)
        .animation(BrambleMotionPolicy.animation(BrambleEase.out.animation(ms: BrambleMotion.drawerMs), reduceMotion: reduceMotion), value: choosing)
    }

    private var activeGroup: AccountGroup? {
        groupFilter.flatMap { id in store.groups.first { $0.id == id } }
    }

    private var visible: [AccountRecord] {
        guard let activeGroup else { return store.records }
        return store.records.filter { activeGroup.accountIds.contains($0.id) }
    }

    private var drawer: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Drawer.gap) {
            HStack(alignment: .center, spacing: BrambleSpace.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Accounts")
                        .brambleText(BrambleTypeScale.title.sized(BrambleMetrics.H2.size), weight: BrambleMetrics.H2.weight, tracking: BrambleMetrics.H2.tracking)
                        .accessibilityAddTraits(.isHeader)
                    Text(store.networkInfo.name).brambleText(BrambleTypeScale.body).foregroundStyle(skin.muted)
                }
                Spacer()
                IconButton(icon: .x, label: "Close accounts", tint: skin.text) { dismiss() }
            }
            if !store.groups.isEmpty { chips }
            ScrollView {
                if visible.isEmpty {
                    StatusLine(text: activeGroup == nil
                               ? "No accounts on this network yet. Add one below."
                               : "No accounts in this group yet. Open an account's folder button to add it.")
                } else {
                    VStack(spacing: BrambleSpace.xs) {
                        ForEach(visible, id: \.id) { record in row(record) }
                    }
                }
            }
            VStack(spacing: BrambleMetrics.Section.gap) {
                PillButton("Add account", kind: .secondary, icon: .plus, busy: store.busy) { choosing = true }
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
            HStack(spacing: BrambleMetrics.Pill.gap) {
                chip(nil, "All", .wallet)
                ForEach(store.groups, id: \.id) { group in chip(group.id, group.name, groupIcon(group.icon)) }
            }
        }
        .accessibilityLabel("Filter by group")
    }

    /// `.group-chip`: the pill silhouette, raised to the hit height; the pressed one on accent-soft.
    private func chip(_ id: String?, _ label: String, _ icon: BrambleIconName) -> some View {
        let selected = groupFilter == id
        let m = BrambleMetrics.Pill.self
        return Button { groupFilter = id } label: {
            HStack(spacing: m.gap) {
                BrambleIcon(icon, size: BrambleMetrics.HardwarePill.glyph)
                Text(label).brambleText(BrambleTypeScale.caption.sized(m.fontSize), weight: m.weight).lineLimit(1)
            }
            .foregroundStyle(selected ? skin.accent : skin.text)
            .padding(m.padding)
            .frame(minHeight: m.height)
        }
        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : skin.elevated, pressed: skin.softPress, shape: Capsule(), scale: BramblePress.iconButton, hit: CGSize(width: BrambleHit.minimum, height: m.height)))
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private func row(_ record: AccountRecord) -> some View {
        let selected = record.id == store.activeRecord?.id
        let folder = store.groups.first { $0.id == record.groupId }
        let pickerLabel = folder.map { "Folder: \($0.name)" } ?? "No folder — choose one"
        let m = BrambleMetrics.Drawer.self
        return VStack(spacing: BrambleSpace.xs) {
            HStack(spacing: BrambleSpace.xs) {
                Button {
                    Task { await store.select(id: record.id) }
                    dismiss()
                } label: {
                    HStack(spacing: m.rowGap) {
                        AccountAvatarView(address: record.address)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.displayName).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold).lineLimit(1)
                            Text(record.shortAddress)
                                .brambleText(BrambleTypeScale.mono, weight: BrambleWeight.semibold, mono: true)
                                .foregroundStyle(skin.muted)
                        }
                        Spacer(minLength: 0)
                        if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
                    }
                    .padding(m.rowPadding)
                    .frame(minHeight: m.rowHeight)
                }
                .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: RoundedRectangle(cornerRadius: m.rowRadius, style: .continuous), scale: BramblePress.drawerRow))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(record.displayName), \(record.shortAddress)")
                .accessibilityValue(record.address)
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
                .accessibilityHint(selected ? "" : "Switches to this account")
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
        .background(skin.elevated, in: RoundedRectangle(cornerRadius: BrambleMetrics.MenuRow.radius, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: BrambleMetrics.MenuRow.radius, style: .continuous))
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
            let m = BrambleMetrics.MenuRow.self
            HStack(spacing: m.gap) {
                BrambleIcon(icon, size: m.glyph).foregroundStyle(skin.muted)
                Text(name).brambleText(BrambleTypeScale.body.sized(m.titleSize), weight: m.titleWeight)
                Spacer(minLength: 0)
                if selected { BrambleIcon(.check).foregroundStyle(skin.accent) }
            }
            .padding(m.padding)
            .frame(minHeight: m.height)
        }
        .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : .clear, pressed: skin.softPress, shape: Rectangle(), scale: 1))
        .accessibilityLabel(name)
        .accessibilityIdentifier("folder-option-\(id ?? "none")")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
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
        VStack(alignment: .leading, spacing: BrambleMetrics.Drawer.gap) {
            HStack(spacing: BrambleSpace.sm) {
                Text("Add a new account")
                    .brambleText(BrambleTypeScale.title.sized(BrambleMetrics.H2.size), weight: BrambleMetrics.H2.weight, tracking: BrambleMetrics.H2.tracking)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                IconButton(icon: .x, label: "Close Add account", tint: skin.text, action: close)
            }
            VStack(spacing: BrambleMetrics.Onboarding.fieldsGap) {
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
