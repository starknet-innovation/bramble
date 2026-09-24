import BrambleCore
import SwiftUI

/// The manage view's "Groups" accordion (`group-members.ts` / `group-ui.ts`): a leading "Create a
/// group" panel, then one row per group that expands into its rename/icon/delete controls and a
/// checklist of every account across networks. One panel is open at a time; with no groups yet
/// the create panel starts open.
struct GroupsSection: View {
    /// The create panel's slot in the one-open-panel accordion (`CREATE_GROUP_PANEL`).
    static let createPanel = "__create__"

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
                    header(id: group.id, icon: groupIcon(group.icon), title: group.name,
                           hint: "\(count) account\(count == 1 ? "" : "s")")
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
            let m = BrambleMetrics.MenuRow.self
            HStack(spacing: m.gap) {
                BrambleIcon(icon, size: m.glyph).foregroundStyle(skin.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).brambleText(BrambleTypeScale.body.sized(m.titleSize), weight: m.titleWeight)
                    if let hint { Text(hint).brambleText(BrambleTypeScale.caption.sized(m.valueSize)).foregroundStyle(skin.muted) }
                }
                Spacer(minLength: m.gap)
                BrambleIcon(isOpen ? .chevronDown : .chevronRight).foregroundStyle(skin.muted)
            }
            .padding(m.padding)
            .frame(minHeight: m.height)
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
            GroupForm(name: group.name, icon: group.icon, action: "Save changes", actionIcon: .check) { name, icon in
                await store.updateGroup(id: group.id, name: name, icon: icon)
            }
            if store.allRecords.isEmpty {
                StatusLine(text: "No accounts yet. Add one above to start bucketing.")
            }
            ForEach(store.allRecords, id: \.id) { record in
                let member = group.accountIds.contains(record.id)
                Button { Task { await store.toggleMember(record.id, of: group.id) } } label: {
                    HStack(spacing: BrambleMetrics.Drawer.rowGap) {
                        AccountAvatarView(address: record.address)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.displayName)
                                .brambleText(BrambleTypeScale.body.sized(BrambleMetrics.MenuRow.titleSize), weight: BrambleMetrics.MenuRow.titleWeight)
                                .lineLimit(1)
                            Text(record.shortAddress).brambleText(BrambleTypeScale.mono, mono: true).foregroundStyle(skin.muted)
                        }
                        Spacer(minLength: 0)
                        if spansNetworks {
                            Text(store.networkName(of: record))
                                .brambleText(BrambleTypeScale.caption.sized(BrambleMetrics.MenuRow.valueSize), weight: BrambleWeight.semibold)
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
    }
}

/// The shared create/edit form: a name field, the icon grid, and one submit action.
struct GroupForm: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.skin) private var skin
    @State var name = ""
    @State var icon = "folder"
    let action: String
    let actionIcon: BrambleIconName
    let submit: (String, String) async -> Void
    @State private var busy = false

    init(name: String = "", icon: String = "folder", action: String, actionIcon: BrambleIconName,
         submit: @escaping (String, String) async -> Void) {
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
                    if next.utf16.count > 64 { name = String(next.prefix(64)) }
                }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: BrambleSpace.xs), count: 6), spacing: BrambleSpace.xs) {
                ForEach(groupIcons(), id: \.self) { glyph in
                    let selected = glyph == icon
                    Button { icon = glyph } label: {
                        BrambleIcon(groupIcon(glyph), size: BrambleMetrics.MenuRow.glyph)
                            .foregroundStyle(selected ? skin.accent : skin.muted)
                            .frame(maxWidth: .infinity, minHeight: BrambleMetrics.IconButton.size)
                    }
                    .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : skin.elevated, pressed: skin.softPress,
                                                shape: RoundedRectangle(cornerRadius: BrambleMetrics.Field.radius, style: .continuous),
                                                scale: BramblePress.iconButton))
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
                    try? await Task.sleep(for: .seconds(3))
                    armed = false
                }
            }
        }
    }
}
