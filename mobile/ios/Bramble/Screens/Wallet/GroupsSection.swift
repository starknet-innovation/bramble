import BrambleCore
import SwiftUI

/// The manage view's "Groups" accordion (`group-members.ts` / `group-ui.ts`): a leading "Create a
/// group" panel, then one row per group that expands into its rename/icon/delete controls and a
/// checklist of every account across networks. One panel is open at a time; with no groups yet
/// the create panel starts open.
struct GroupsSection: View {
    /// The create panel's slot in the one-open-panel accordion (`CREATE_GROUP_PANEL`).
    static let createPanel = "__create__"

    private enum Layout {
        /// Vertical gap between stacked lines in a group header and a member row.
        static let lineSpacing: CGFloat = 2
    }

    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var expanded: String?

    private var open: String? { expanded ?? (store.groups.isEmpty ? Self.createPanel : nil) }

    var body: some View {
        SettingsSection(title: "Groups") {
            VStack(spacing: 0) {
                header(id: Self.createPanel, icon: .plus, title: "Create a group", hint: nil)
                if open == Self.createPanel {
                    GroupForm(action: "Create group", actionIcon: .plus) { name, icon in
                        if await store.createGroup(name: name, icon: icon) { expanded = nil }
                    }
                    .padding(BrambleMetrics.MenuRow.padding)
                    .padding(.bottom, BrambleMetrics.Section.gap)
                }
            }
            ForEach(store.groups, id: \.id) { group in
                VStack(spacing: 0) {
                    let count = group.accountIds.count
                    header(
                        id: group.id,
                        icon: groupIcon(group.icon),
                        title: group.name,
                        hint: "\(count) account\(count == 1 ? "" : "s")"
                    )
                    if open == group.id {
                        editor(group)
                            .padding(BrambleMetrics.MenuRow.padding)
                            .padding(.bottom, BrambleMetrics.Section.gap)
                    }
                }
            }
        }
    }

    private func header(id: String, icon: BrambleIconName, title: String, hint: String?) -> some View {
        let isOpen = open == id
        return Button { expanded = isOpen ? "" : id } label: {
            let menuRow = BrambleMetrics.MenuRow.self
            HStack(spacing: menuRow.gap) {
                BrambleIcon(icon, size: menuRow.glyph).foregroundStyle(skin.muted)
                VStack(alignment: .leading, spacing: Layout.lineSpacing) {
                    Text(title).brambleText(BrambleTypeScale.body.sized(menuRow.titleSize), weight: menuRow.titleWeight)
                    if let hint {
                        Text(hint)
                            .brambleText(BrambleTypeScale.caption.sized(menuRow.valueSize))
                            .foregroundStyle(skin.muted)
                    }
                }
                Spacer(minLength: menuRow.gap)
                BrambleIcon(isOpen ? .chevronDown : .chevronRight).foregroundStyle(skin.muted)
            }
            .padding(menuRow.padding)
            .frame(minHeight: menuRow.height)
        }
        .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Rectangle(), scale: 1))
        .accessibilityLabel(title)
        .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
        .accessibilityHint(hint ?? "")
    }

    private func editor(_ group: AccountGroup) -> some View {
        let count = group.accountIds.count
        let spansNetworks = Set(store.allRecords.map(\.network)).count > 1
        return VStack(alignment: .leading, spacing: BrambleMetrics.Section.gap) {
            HStack {
                Eyebrow(text: "\(count) member\(count == 1 ? "" : "s")")
                Spacer()
                DeleteGroupButton(group: group)
            }
            GroupForm(action: "Save changes", actionIcon: .check, name: group.name, icon: group.icon) { name, icon in
                await store.updateGroup(id: group.id, name: name, icon: icon)
            }
            if store.allRecords.isEmpty {
                StatusLine(text: "No accounts yet. Add one above to start bucketing.")
            }
            ForEach(store.allRecords, id: \.id) { record in
                memberRow(record, of: group, spansNetworks: spansNetworks)
            }
        }
    }

    /// One checklist line: toggles the account's membership in the group.
    private func memberRow(_ record: AccountRecord, of group: AccountGroup, spansNetworks: Bool) -> some View {
        let member = group.accountIds.contains(record.id)
        let menuRow = BrambleMetrics.MenuRow.self
        return Button { Task { await store.toggleMember(record.id, of: group.id) } } label: {
            HStack(spacing: BrambleMetrics.Drawer.rowGap) {
                AccountAvatarView(address: record.address)
                VStack(alignment: .leading, spacing: Layout.lineSpacing) {
                    Text(record.displayName)
                        .brambleText(BrambleTypeScale.body.sized(menuRow.titleSize), weight: menuRow.titleWeight)
                        .lineLimit(1)
                    Text(record.shortAddress)
                        .brambleText(BrambleTypeScale.mono, mono: true)
                        .foregroundStyle(skin.muted)
                }
                Spacer(minLength: 0)
                if spansNetworks {
                    Text(store.networkName(of: record))
                        .brambleText(BrambleTypeScale.caption.sized(menuRow.valueSize), weight: BrambleWeight.semibold)
                        .foregroundStyle(skin.muted)
                }
                BrambleIcon(member ? .check : .plus).foregroundStyle(member ? skin.accent : skin.muted)
            }
            .frame(minHeight: BrambleMetrics.Drawer.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(record.displayName), \(record.shortAddress)")
        .accessibilityAddTraits(member ? [.isButton, .isSelected] : .isButton)
    }
}

/// The shared create/edit form: a name field, the icon grid, and one submit action.
struct GroupForm: View {
    private enum Layout {
        /// Longest group name, in UTF-16 units, the field keeps.
        static let maxNameLength = 64
        /// Columns in the icon picker grid.
        static let iconColumns = 6
    }

    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State private var name = ""
    @State private var icon = "folder"
    let action: String
    let actionIcon: BrambleIconName
    let submit: (String, String) async -> Void
    @State private var busy = false

    init(
        action: String,
        actionIcon: BrambleIconName,
        name: String = "",
        icon: String = "folder",
        submit: @escaping (String, String) async -> Void
    ) {
        _name = State(initialValue: name)
        _icon = State(initialValue: icon)
        self.action = action
        self.actionIcon = actionIcon
        self.submit = submit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Onboarding.fieldsGap) {
            BrambleField(placeholder: action == "Create group" ? "New group name" : "Group name", text: $name)
                .onChange(of: name) { _, next in
                    if next.utf16.count > Layout.maxNameLength { name = String(next.prefix(Layout.maxNameLength)) }
                }
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: BrambleSpace.xs), count: Layout.iconColumns),
                spacing: BrambleSpace.xs
            ) {
                ForEach(groupIcons(), id: \.self) { glyph in
                    let selected = glyph == icon
                    Button { icon = glyph } label: {
                        BrambleIcon(groupIcon(glyph), size: BrambleMetrics.MenuRow.glyph)
                            .foregroundStyle(selected ? skin.accent : skin.muted)
                            .frame(maxWidth: .infinity, minHeight: BrambleMetrics.IconButton.size)
                    }
                    .buttonStyle(
                        FillPressStyle(
                            fill: selected ? skin.accentSoft : skin.elevated,
                            pressed: skin.softPress,
                            shape: RoundedRectangle(cornerRadius: BrambleMetrics.Field.radius, style: .continuous),
                            scale: BramblePress.iconButton
                        )
                    )
                    .accessibilityLabel(glyph)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .accessibilityLabel("Group icon")
            PillButton(action, kind: .secondary, icon: actionIcon, busy: busy) {
                guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    store.toast = "Enter a group name"
                    return
                }
                busy = true
                Task {
                    await submit(name, icon)
                    if action == "Create group" { name = "" }
                    busy = false
                }
            }
        }
    }
}

/// `data-remove-group`: a danger icon button that asks for a second tap before deleting.
struct DeleteGroupButton: View {
    /// How long, in seconds, the armed state waits for the confirming second tap.
    private static let confirmWindowSeconds = 3

    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    let group: AccountGroup
    @State private var armed = false

    var body: some View {
        IconButton(icon: .x, label: armed ? "Tap again to delete" : "Delete \(group.name)", tint: skin.danger) {
            if armed {
                Task { await store.deleteGroup(id: group.id) }
            } else {
                armed = true
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(Self.confirmWindowSeconds))
                    armed = false
                }
            }
        }
    }
}
