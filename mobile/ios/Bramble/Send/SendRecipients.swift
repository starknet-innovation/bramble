import BrambleCore
import Foundation

/// The lists on Send's recipient stage (`send-recipient-view.ts` `recipientStage`, filtered as
/// `transfer-compose-ui.ts` `bindRecipientControls` does): the address book, then the user's own
/// accounts under the folder each is filed in. Pure: the view hands in the store's contacts,
/// groups and this network's accounts. Names only ever come from the user's own rows, never from
/// typed text, and every address is compared through the core's canonical form.
enum SendRecipients {
    /// One pickable recipient: a saved contact, or one of the user's accounts.
    struct Row: Equatable, Identifiable {
        let id: String
        /// The contact's label or the account's display name.
        let name: String
        /// The full address, the value a tap sends to.
        let address: String
        /// `accountLabel(address)`.
        let short: String
        /// The sending account itself (`currentAccount`).
        let current: Bool

        /// `data-send-search`: what a search matches, name and address in lower case.
        var searchText: String { "\(name) \(address)".lowercased() }
    }

    /// One folder of the user's accounts: its heading (`send-folder-head`) and its rows.
    struct Folder: Equatable, Identifiable {
        let id: String
        let name: String
        /// A `GROUP_ICONS` name.
        let icon: String
        let rows: [Row]
    }

    /// The home folder: where an account in no group is listed, as the drawer does, so a new
    /// account appears without anything being written for it. Mobile stores no default groups, so
    /// the folder is synthesised; the colon keeps its id clear of every group slug.
    static let homeFolderId = ":home"
    /// The home folder's icon (`DEFAULT_GROUPS`).
    static let homeFolderIcon = "wallet"

    /// This network's saved contacts, in the address book's order.
    static func contacts(_ contacts: [Contact]) -> [Row] {
        contacts.map { contact in
            Row(
                id: "contact:\(contact.id)",
                name: contact.label,
                address: contact.address,
                short: shortAddress(contact.address),
                current: false
            )
        }
    }

    /// `folderSections` over the user's groups: the home folder first, then each group in its
    /// order. An account belongs to the first group that lists it, else to the home folder. A
    /// folder with no account is not listed.
    static func folders(groups: [AccountGroup], accounts: [AccountRecord], senderId: String) -> [Folder] {
        let home = AccountGroup(id: homeFolderId, name: SendCopy.myAccounts, icon: homeFolderIcon, accountIds: [])
        return ([home] + groups).compactMap { group in
            let members = accounts.filter { account in
                let filed = groups.first { $0.accountIds.contains(account.id) }
                return (filed?.id ?? homeFolderId) == group.id
            }
            guard !members.isEmpty else { return nil }
            let rows = members.map { account in
                Row(
                    id: account.id,
                    name: account.displayName,
                    address: account.address,
                    short: account.shortAddress,
                    current: account.id == senderId
                )
            }
            return Folder(id: group.id, name: group.name, icon: group.icon, rows: rows)
        }
    }

    /// The rows a search shows: all of them for an empty query, else those whose name or address
    /// contains it. The query is trimmed and compared in lower case.
    static func matching(_ rows: [Row], query: String) -> [Row] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? rows : rows.filter { $0.searchText.contains(needle) }
    }

    /// The folders a search shows. With no query every folder stays; during a search a folder
    /// with nothing left to show drops out rather than leave a heading over an empty space.
    static func matching(_ folders: [Folder], query: String) -> [Folder] {
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        return folders.compactMap { folder in
            let rows = matching(folder.rows, query: query)
            if searching, rows.isEmpty { return nil }
            return Folder(id: folder.id, name: folder.name, icon: folder.icon, rows: rows)
        }
    }

    /// `knownRecipientLabel`: the name of the listed row the typed address belongs to, compared
    /// as canonical felts, so a padded or differently cased spelling still matches.
    static func knownLabel(of typed: String, in rows: [Row]) -> String? {
        guard let canonical = validateRecipient(input: typed) else { return nil }
        return rows.first { validateRecipient(input: $0.address) == canonical }?.name
    }

    /// Whether to offer saving the typed address: usable, and not already a listed row, so saving
    /// is a deliberate act on a new recipient rather than a second name for a known one.
    static func offersSave(typed: String, rows: [Row]) -> Bool {
        validateRecipient(input: typed) != nil && knownLabel(of: typed, in: rows) == nil
    }
}
