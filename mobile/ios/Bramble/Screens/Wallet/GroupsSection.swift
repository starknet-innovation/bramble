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
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            Eyebrow(text: "Groups").padding(.top, BrambleSpace.sm)
            MenuGroup {
                VStack(spacing: 0) {
                    header(id: Self.createPanel, icon: .plus, title: "Create a group", hint: nil)
                    if open == Self.createPanel {
                        GroupForm(action: "Create group", actionIcon: .plus) { name, icon in
                            if await store.createGroup(name: name, icon: icon) { expanded = nil }
                        }
                        .padding(BrambleSpace.md)
                    }
                }
                ForEach(store.groups, id: \.id) { group in
                    VStack(spacing: 0) {
                        let count = group.accountIds.count
                        header(id: group.id, icon: groupIcon(group.icon), title: group.name,
                               hint: "\(count) account\(count == 1 ? "" : "s")")
                        if open == group.id { editor(group).padding(BrambleSpace.md) }
                    }
                }
            }
        }
    }

    private func header(id: String, icon: BrambleIconName, title: String, hint: String?) -> some View {
        let isOpen = open == id
        return Button { expanded = isOpen ? "" : id } label: {
            HStack(spacing: BrambleSpace.sm) {
                BrambleIcon(icon, size: 20).foregroundStyle(skin.muted).frame(width: 28, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).brambleText(BrambleTypeScale.row, weight: BrambleWeight.semibold)
                    if let hint { Text(hint).brambleText(BrambleTypeScale.caption).foregroundStyle(skin.muted) }
                }
                Spacer(minLength: 0)
                BrambleIcon(isOpen ? .chevronDown : .chevronRight).foregroundStyle(skin.muted)
            }
            .padding(.horizontal, BrambleSpace.lg)
            .frame(minHeight: 52)
        }
        .buttonStyle(FillPressStyle(fill: .clear, pressed: skin.softPress, shape: Rectangle(), scale: 1))
        .accessibilityLabel(title)
        .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
    }

    private func editor(_ group: AccountGroup) -> some View {
        let count = group.accountIds.count
        let spansNetworks = Set(store.allRecords.map(\.network)).count > 1
        return VStack(alignment: .leading, spacing: BrambleSpace.md) {
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
                    HStack(spacing: BrambleSpace.md) {
                        AccountAvatarView(address: record.address, size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(record.displayName).brambleText(BrambleTypeScale.body, weight: BrambleWeight.semibold).lineLimit(1)
                            Text(record.shortAddress).brambleText(BrambleTypeScale.caption, mono: true).foregroundStyle(skin.muted)
                        }
                        Spacer(minLength: 0)
                        if spansNetworks {
                            Text(store.networkName(of: record)).brambleText(BrambleTypeScale.caption, weight: BrambleWeight.semibold).foregroundStyle(skin.muted)
                        }
                        BrambleIcon(member ? .check : .plus, size: 18).foregroundStyle(member ? skin.accent : skin.muted)
                    }
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(record.displayName)
                .accessibilityAddTraits(member ? .isSelected : [])
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
        VStack(alignment: .leading, spacing: BrambleSpace.md) {
            BrambleField(placeholder: action == "Create group" ? "New group name" : "Group name", text: $name)
                .onChange(of: name) { _, next in
                    if next.utf16.count > 64 { name = String(next.prefix(64)) }
                }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: BrambleSpace.xs), count: 6), spacing: BrambleSpace.xs) {
                ForEach(groupIcons(), id: \.self) { glyph in
                    let selected = glyph == icon
                    Button { icon = glyph } label: {
                        BrambleIcon(groupIcon(glyph), size: 20)
                            .foregroundStyle(selected ? skin.text : skin.muted)
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .buttonStyle(FillPressStyle(fill: selected ? skin.accentSoft : skin.elevated, pressed: skin.softPress,
                                                shape: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous), scale: 0.96))
                    .accessibilityLabel(glyph)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .accessibilityLabel("Group icon")
            PillButton(action, kind: .secondary, icon: actionIcon, busy: busy) {
                guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    store.notify("Enter a group name", tone: .error)
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
