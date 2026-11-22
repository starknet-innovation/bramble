package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.bramble.core.ActivityContact
import org.bramble.core.ActivityEntry
import org.bramble.core.ActivityFilter
import org.bramble.core.ActivityKind
import org.bramble.core.ActivitySort
import org.bramble.core.NetworkId
import org.bramble.core.TokenPreferences
import org.bramble.core.TransferDirection
import org.bramble.core.TxStatus
import org.bramble.wallet.portfolio.ALL_ACTIVITY
import org.bramble.wallet.portfolio.activityFeedState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Activity feed's filter, sort and counterparty summary, port of the iOS `ActivityFeedTests`:
 * the controls offer only what the feed holds, an axis keeps the rows it names, a value the feed
 * no longer offers resets to all, the amount sort is one untitled list grouped by token, and a
 * search naming a contact summarises that party. Every rule is the core's; this checks the wiring.
 */
@RunWith(AndroidJUnit4::class)
class ActivityFeedTest {
    private val tracked = TokenPreferences(null).tracked(NetworkId.MAINNET).map { it.token }

    private val feed =
        listOf(
            row("0xa1", TransferDirection.OUT, "1.5", "STRK", ALICE),
            row("0xa2", TransferDirection.IN, "0.1", "ETH", BOB, TxStatus.PENDING),
            row("0xa3", TransferDirection.IN, "2", "STRK", ALICE),
        )

    private fun row(
        hash: String,
        direction: TransferDirection,
        amount: String,
        symbol: String,
        party: String,
        status: TxStatus = TxStatus.ACCEPTED,
    ) = ActivityEntry(
        accountId = "SN_MAIN:0x1",
        amount = amount,
        counterparty = party,
        direction = direction,
        failureNotice = null,
        finalizedOnL1 = null,
        hash = hash,
        kind = ActivityKind.TRANSFER,
        network = NetworkId.MAINNET,
        notFoundCount = null,
        status = status,
        submittedAt = SUBMITTED_AT,
        summary = "${if (direction == TransferDirection.IN) "Received" else "Sent"} $amount $symbol",
        token = symbol,
        tokenAddress = if (symbol == "ETH") ETH else STRK,
    )

    private fun state(
        filter: ActivityFilter,
        contacts: List<ActivityContact> = emptyList(),
    ) = activityFeedState(feed, filter, tracked, contacts, NOW_MS)

    private fun hashes(filter: ActivityFilter) = state(filter).entries.flatten().map { it.hash }

    @Test
    fun filterAndSortGoThroughTheCore() {
        val all = state(ALL_ACTIVITY)
        assertEquals(listOf("Received", "Sent"), all.options.actions)
        assertEquals(listOf(TxStatus.ACCEPTED, TxStatus.PENDING), all.options.statuses)
        assertNull(all.result)

        assertEquals(listOf("0xa2", "0xa3"), hashes(ALL_ACTIVITY.copy(action = "Received")).sorted())
        assertEquals("2 of 3 transactions", state(ALL_ACTIVITY.copy(action = "Received")).result)
        assertNull(
            "a status the feed does not hold resets to all",
            state(ALL_ACTIVITY.copy(status = TxStatus.REJECTED)).filter.status,
        )

        val byAmount = state(ALL_ACTIVITY.copy(sort = ActivitySort.AMOUNT))
        assertEquals(listOf(""), byAmount.groups.map { it.heading })
        assertEquals(listOf("0xa2", "0xa3", "0xa1"), byAmount.entries.flatten().map { it.hash })

        val none = state(ALL_ACTIVITY.copy(query = "nobody"))
        assertTrue(none.hasNoMatches)
        assertEquals(0, none.groups.size)
    }

    @Test
    fun contactSearchSummarisesParty() {
        val contacts = listOf(ActivityContact(ALICE, "Alice"))
        assertNull(state(ALL_ACTIVITY, contacts).summary)
        val found = state(ALL_ACTIVITY.copy(query = "alice"), contacts)
        assertEquals(
            listOf("0xa1", "0xa3"),
            found.entries
                .flatten()
                .map { it.hash }
                .sorted(),
        )
        val summary = found.summary
        assertNotNull(summary)
        assertEquals("Alice", summary?.label)
        val body = summary?.body.orEmpty()
        assertTrue(body, body.startsWith("2 transactions · "))
        assertTrue(body, body.contains("Sent 1.5 STRK"))
        assertTrue(body, body.contains("Received 2 STRK"))
    }

    private companion object {
        const val SUBMITTED_AT = 1_790_000_000_000uL
        const val NOW_MS = 1_790_251_200_000.0
        const val ALICE = "0x5a1b"
        const val BOB = "0x6c2d"
        const val STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
        const val ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    }
}
