import BrambleCore
import SwiftUI

/// `activityToolbar` (`activity-views.ts`): the search, the Type, Status and Token selects (each
/// offering only what the feed holds, from the core's options) and the Date / Amount sort. Every
/// change goes to the core through `PortfolioStore.refilter`; nothing here decides which rows match.
struct ActivityFilterBar: View {
    @Environment(WalletStore.self) private var store

    var body: some View {
        let portfolio = store.portfolio
        let feed = portfolio.feed
        let filter = feed.filter
        VStack(alignment: .leading, spacing: BrambleSpace.sm) {
            BrambleField(
                label: "Search",
                placeholder: "Address or saved name",
                text: Binding(
                    get: { portfolio.feed.filter.query },
                    set: { query in portfolio.refilter(change(\.query, to: query)) }
                ),
                mono: true
            )
            ActivitySelect(
                label: "Type",
                all: "All types",
                options: feed.options.actions.map { (text: $0, value: $0) },
                selected: filter.action
            ) { portfolio.refilter(change(\.action, to: $0)) }
            ActivitySelect(
                label: "Status",
                all: "All statuses",
                options: feed.options.statuses.map { (text: Self.statusText($0), value: $0) },
                selected: filter.status
            ) { portfolio.refilter(change(\.status, to: $0)) }
            ActivitySelect(
                label: "Token",
                all: "All tokens",
                options: feed.options.tokens.map { (text: $0.label, value: $0.key) },
                selected: filter.token
            ) { portfolio.refilter(change(\.token, to: $0)) }
            SegmentedControl(
                options: [("Date", ActivitySort.date), ("Amount", ActivitySort.amount)],
                selection: Binding(
                    get: { portfolio.feed.filter.sort },
                    set: { sort in portfolio.refilter(change(\.sort, to: sort)) }
                )
            )
            .accessibilityLabel("Sort")
        }
    }

    /// The current filter with one axis changed.
    private func change<Value>(_ axis: WritableKeyPath<ActivityFilter, Value>, to value: Value) -> ActivityFilter {
        var next = store.portfolio.feed.filter
        next[keyPath: axis] = value
        return next
    }

    /// The status words the Status select offers (`STATUS_TEXT` in `activity-views.ts`).
    static func statusText(_ status: TxStatus) -> String {
        switch status {
        case .accepted:
            "Accepted"

        case .pending:
            "Pending"

        case .preconfirmed:
            "Pre-confirmed"

        case .rejected:
            "Rejected"

        case .reverted:
            "Reverted"
        }
    }
}

/// One `selectField`: its label and the chosen option's text on the elevated fill, opening a menu of
/// `all` (nil: the axis off) then the options (shown text and value).
private struct ActivitySelect<Value: Hashable>: View {
    @Environment(\.skin) private var skin
    let label: String
    let all: String
    let options: [(text: String, value: Value)]
    let selected: Value?
    let choose: (Value?) -> Void

    var body: some View {
        let shown = options.first { $0.value == selected }?.text ?? all
        Menu {
            Button(all) { choose(nil) }
            ForEach(options, id: \.value) { option in
                Button(option.text) { choose(option.value) }
            }
        } label: {
            HStack(spacing: BrambleSpace.sm) {
                Text(label)
                    .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                    .foregroundStyle(skin.muted)
                Text(shown)
                    .brambleText(BrambleTypeScale.label)
                    .foregroundStyle(skin.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                BrambleIcon(.chevronDown)
                    .foregroundStyle(skin.muted)
            }
            .padding(.horizontal, BrambleSpace.md)
            .frame(minHeight: BrambleControl.hit)
            .background(skin.elevated, in: FieldShape())
        }
        .accessibilityLabel(label)
        .accessibilityValue(shown)
    }
}

/// The counterparty summary above the feed (`#activity-party-summary`) while a search resolves one
/// party: the name (or address) and the core's detail line, both plain text.
struct ActivityPartySummaryView: View {
    @Environment(\.skin) private var skin
    let parts: ActivityPartySummaryParts

    var body: some View {
        VStack(alignment: .leading, spacing: BrambleSpace.xs) {
            Text(parts.label)
                .brambleText(BrambleTypeScale.label, weight: BrambleWeight.semibold)
                .foregroundStyle(skin.text)
            Text(parts.body)
                .brambleText(BrambleTypeScale.caption)
                .foregroundStyle(skin.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(BrambleSpace.md)
        .background(skin.elevated, in: RoundedRectangle(cornerRadius: BrambleRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("activity-party-summary")
    }
}

extension WalletStore {
    /// The names the Activity search resolves on the active network (`activityContacts`): the
    /// person's labelled accounts, then the address book. The core matches the first contact whose
    /// address is the counterparty's, so an account's own label wins, as in the extension.
    var activityContacts: [ActivityContact] {
        let accounts = records.filter { $0.network == network }.compactMap { record in
            record.label.map { ActivityContact(address: record.address, label: $0) }
        }
        return accounts + coordination.contacts.map { ActivityContact(address: $0.address, label: $0.label) }
    }
}
