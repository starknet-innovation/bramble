import BrambleCore
import SwiftUI

/// `.send-recipient-stage` (`recipientStage`): the sending account with its copy control, the
/// "Send to" field, the address book (with Save for a new, valid address), the user's accounts
/// under their folders (the sender marked "Current"), and Continue. Typing filters every list;
/// what is shown and what the Save offer means are `SendRecipients`' pure rules.
struct SendRecipientView: View {
    @Environment(WalletStore.self) private var store
    @Environment(\.openCoordinationFlow) private var openCoordination
    @Bindable var model: SendFlowModel

    var body: some View {
        let metrics = BrambleMetrics.Send.self
        let contacts = SendRecipients.contacts(store.coordination.contacts)
        let folders = SendRecipients.folders(
            groups: store.groups,
            accounts: model.accounts,
            senderId: model.account.id
        )
        let query = model.recipientInput
        let shownContacts = SendRecipients.matching(contacts, query: query)
        let shownFolders = SendRecipients.matching(folders, query: query)
        let known = contacts + folders.flatMap(\.rows)
        VStack(alignment: .leading, spacing: metrics.stageGap) {
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                SendHeading(text: SendCopy.sendFrom)
                SendOriginCard(account: model.account)
            }
            VStack(alignment: .leading, spacing: BrambleSpace.sm) {
                SendHeading(text: SendCopy.sendTo, kicker: true)
                SendSearchField(
                    placeholder: SendCopy.recipientPlaceholder,
                    label: SendCopy.recipientFieldLabel,
                    text: $model.recipientInput,
                    invalid: model.recipientError != nil
                ) { proceed(known) }
                StatusLine(text: model.recipientError, tone: .danger)
            }
            addressBook(shownContacts, offersSave: SendRecipients.offersSave(typed: query, rows: known))
            ForEach(shownFolders) { folder in folderList(folder) }
            if shownContacts.isEmpty, shownFolders.allSatisfy(\.rows.isEmpty) {
                StatusLine(text: SendCopy.noMatchingRecipient)
            }
            PillButton(SendCopy.continueWithAddress) { proceed(known) }
                .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .task { await store.coordination.refresh() }
    }

    /// The address book's heading, its matching contacts, and Save for a typed address that is
    /// usable and not listed yet (it opens the address book with the address filled in).
    private func addressBook(_ rows: [SendRecipients.Row], offersSave: Bool) -> some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Send.listGap) {
            SendListHeading(icon: .book, title: SendCopy.addressBook)
            ForEach(rows) { row in recipientRow(row) }
            if offersSave {
                PillButton(SendCopy.saveRecipient, kind: .secondary, icon: .book, small: true) {
                    openCoordination(.saveAddress(model.recipientInput.trimmingCharacters(in: .whitespaces)))
                }
            }
        }
    }

    /// One folder: its glyph, name and number of accounts, then its rows.
    private func folderList(_ folder: SendRecipients.Folder) -> some View {
        VStack(alignment: .leading, spacing: BrambleMetrics.Send.listGap) {
            SendListHeading(icon: groupIcon(folder.icon), title: folder.name, count: folder.rows.count)
            ForEach(folder.rows) { row in recipientRow(row) }
        }
    }

    private func recipientRow(_ row: SendRecipients.Row) -> some View {
        SendChoiceRow(
            title: row.name,
            detail: row.short,
            note: row.current ? SendCopy.currentAccount : nil,
            label: row.current
                ? "\(row.name), \(row.short), \(SendCopy.currentAccount)"
                : "\(row.name), \(row.short)",
            mark: { AccountAvatarView(address: row.address, size: BrambleSize.mark) },
            action: { model.useRecipient(row.address, label: row.name) }
        )
    }

    /// Continue: a typed address that is already listed reads as the row it matches, the same as
    /// tapping that row would.
    private func proceed(_ known: [SendRecipients.Row]) {
        model.continueWithRecipient(label: SendRecipients.knownLabel(of: model.recipientInput, in: known))
    }
}
