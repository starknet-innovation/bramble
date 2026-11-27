import BrambleCore

/// What the Activity screen shows of one feed under one filter (`activity-views.ts` with
/// `activity-ui.ts`'s `applyActivityView`), every value the core's: the controls' `options`, the
/// `filter` reconciled against them (a value the feed no longer offers resets to all), the rows it
/// keeps as day `groups` (one untitled group for the amount sort, as the extension lists it) with the
/// stored entry behind each row in the same shape (`entries`), and the counterparty `summary` while
/// a search resolves one party.
struct ActivityFeedState {
    /// The unfiltered feed, newest first (the extension's `EMPTY_ACTIVITY_FILTER`).
    static let all = ActivityFilter(action: nil, query: "", sort: .date, status: nil, token: nil)

    var groups: [ActivityDayGroup] = []
    var entries: [[ActivityEntry]] = []
    var filter = Self.all
    var options = ActivityFilterOptions(actions: [], statuses: [], tokens: [])
    var summary: ActivityPartySummaryParts?
    /// The names the search resolves (address book and labelled accounts).
    var contacts: [ActivityContact] = []
    /// How many rows the filter keeps, and how many the feed holds.
    var shown = 0
    var total = 0

    /// True while a search or an axis narrows the feed.
    var isFiltered: Bool {
        !filter.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || filter.action != nil || filter.status != nil || filter.token != nil
    }

    /// `#activity-result`: "3 of 12 transactions" while filtered, else nil.
    var result: String? { isFiltered ? "\(shown) of \(total) transactions" : nil }

    /// True when the feed has rows but the filter keeps none ("No matching transactions.").
    var hasNoMatches: Bool { total > 0 && shown == 0 }

    /// The feed state for `entries` (one account's whole feed, newest first) under `filter`.
    /// `tracked` is every tracked token on the network, and `nowMs` makes the two latest days read
    /// Today and Yesterday.
    init(
        entries all: [ActivityEntry],
        filter: ActivityFilter,
        tracked: [TokenConfig],
        contacts: [ActivityContact],
        nowMs: Double
    ) {
        options = activityFilterOptions(entries: all, tracked: tracked)
        self.filter = reconcileActivityFilter(filter: filter, options: options)
        self.contacts = contacts
        let kept = filterActivity(entries: all, filter: self.filter, tracked: tracked, contacts: contacts)
        let days = kept.isEmpty ? [] : activityGroups(entries: kept, tracked: tracked, nowMs: nowMs)
        groups = self.filter.sort == .amount && !days.isEmpty
            ? [ActivityDayGroup(heading: "", rows: days.flatMap(\.rows))]
            : days
        // `activity_groups` builds one row per entry, in order, and only splits them by day.
        var rest = kept[...]
        entries = groups.map { group in
            defer { rest = rest.dropFirst(group.rows.count) }
            return Array(rest.prefix(group.rows.count))
        }
        summary = activityPartySummary(rows: kept, filter: self.filter, tracked: tracked, contacts: contacts)
            .map { activityPartySummaryParts(summary: $0) }
        shown = kept.count
        total = all.count
    }

    /// The state before any feed is read.
    init() {
        // Every property has its empty default.
    }
}
