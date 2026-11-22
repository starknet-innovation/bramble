package org.bramble.wallet.portfolio

import org.bramble.core.ActivityContact
import org.bramble.core.ActivityDayGroup
import org.bramble.core.ActivityEntry
import org.bramble.core.ActivityFilter
import org.bramble.core.ActivityFilterOptions
import org.bramble.core.ActivityPartySummaryParts
import org.bramble.core.ActivitySort
import org.bramble.core.TokenConfig
import org.bramble.core.activityFilterOptions
import org.bramble.core.activityGroups
import org.bramble.core.activityPartySummary
import org.bramble.core.activityPartySummaryParts
import org.bramble.core.filterActivity
import org.bramble.core.reconcileActivityFilter

/** The unfiltered feed, newest first (the extension's `EMPTY_ACTIVITY_FILTER`). */
val ALL_ACTIVITY = ActivityFilter(action = null, query = "", sort = ActivitySort.DATE, status = null, token = null)

/**
 * What the Activity screen shows of one feed under one filter (`activity-views.ts` with
 * `activity-ui.ts`'s `applyActivityView`), every value the core's: the controls' [options], the
 * [filter] reconciled against them (a value the feed no longer offers resets to all), the rows it
 * keeps as day [groups] (one untitled group for the amount sort, as the extension lists it) with
 * the stored entry behind each row in the same shape ([entries]), and the counterparty [summary]
 * while a search resolves one party.
 *
 * @property groups The kept rows by UTC day, or one untitled group for the amount sort.
 * @property entries The stored entry behind each row of [groups], in the same shape.
 * @property filter The person's filter, reconciled against [options].
 * @property options The values the Type, Status and Token controls offer.
 * @property summary The counterparty summary's two texts, or null.
 * @property contacts The names the search resolves (address book and labelled accounts).
 * @property shown How many rows the filter keeps.
 * @property total How many rows the feed holds.
 */
data class ActivityFeedState(
    val groups: List<ActivityDayGroup> = emptyList(),
    val entries: List<List<ActivityEntry>> = emptyList(),
    val filter: ActivityFilter = ALL_ACTIVITY,
    val options: ActivityFilterOptions = ActivityFilterOptions(emptyList(), emptyList(), emptyList()),
    val summary: ActivityPartySummaryParts? = null,
    val contacts: List<ActivityContact> = emptyList(),
    val shown: Int = 0,
    val total: Int = 0,
) {
    /** True while a search or an axis narrows the feed. */
    val isFiltered: Boolean
        get() = filter.query.isNotBlank() || filter.action != null || filter.status != null || filter.token != null

    /** `#activity-result`: "3 of 12 transactions" while [isFiltered], else null. */
    val result: String? get() = if (isFiltered) "$shown of $total transactions" else null

    /** True when the feed has rows but the filter keeps none ("No matching transactions."). */
    val hasNoMatches: Boolean get() = total > 0 && shown == 0
}

/**
 * The feed state for [entries] (one account's whole feed, newest first) under [filter]. [tracked]
 * is every tracked token on the network, [contacts] the names the search resolves, and [nowMs]
 * makes the two latest days read Today and Yesterday.
 */
fun activityFeedState(
    entries: List<ActivityEntry>,
    filter: ActivityFilter,
    tracked: List<TokenConfig>,
    contacts: List<ActivityContact>,
    nowMs: Double,
): ActivityFeedState {
    val options = activityFilterOptions(entries, tracked)
    val kept = reconcileActivityFilter(filter, options)
    val shown = filterActivity(entries, kept, tracked, contacts)
    val days = if (shown.isEmpty()) emptyList() else activityGroups(shown, tracked, nowMs)
    val groups =
        if (kept.sort == ActivitySort.AMOUNT && days.isNotEmpty()) {
            listOf(ActivityDayGroup("", days.flatMap { it.rows }))
        } else {
            days
        }
    // `activity_groups` builds one row per entry, in order, and only splits them by day.
    var taken = 0
    val grouped = groups.map { group -> shown.drop(taken).take(group.rows.size).also { taken += it.size } }
    return ActivityFeedState(
        groups = groups,
        entries = grouped,
        filter = kept,
        options = options,
        summary = activityPartySummary(shown, kept, tracked, contacts)?.let { activityPartySummaryParts(it) },
        contacts = contacts,
        shown = shown.size,
        total = entries.size,
    )
}

/**
 * Rebuilds [PortfolioStore.feed] from the scope's whole feed under [filter] and [contacts] (by
 * default the ones it holds): after a read, when the person changes the filter, or when the names
 * the search resolves change.
 */
fun PortfolioStore.refilter(
    filter: ActivityFilter = feed.filter,
    contacts: List<ActivityContact> = feed.contacts,
) {
    feed = activityFeedState(activityEntries, filter, tracked.map { it.token }, contacts, clock())
}
