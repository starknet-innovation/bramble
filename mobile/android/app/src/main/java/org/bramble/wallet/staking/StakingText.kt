package org.bramble.wallet.staking

import org.bramble.core.DirectoryEntry
import org.bramble.core.DirectoryPoolEntry
import org.bramble.core.PositionState
import org.bramble.core.RowFigures
import org.bramble.core.StakingException
import org.bramble.core.StakingRowView
import org.bramble.wallet.errors.friendlyError
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

// The staking screens' wording, twin of the iOS `StakingText.swift`: the extension's copy
// (`StakingCopy`, generated) filled with the core's figures. Pure; every figure is a string the
// core formatted from an on-chain read. The core's formatters (`compactAmount`, `accountLabel`)
// are passed in, so the JVM tests run without the native library.

private const val AMOUNT = "amount"
private const val SYMBOL = "symbol"
private const val DAY = 86_400uL
private const val HOUR = 3_600uL
private const val MINUTE = 60uL

private val units =
    listOf(
        Triple(DAY, StakingCopy.durationDay, StakingCopy.durationDays),
        Triple(HOUR, StakingCopy.durationHour, StakingCopy.durationHours),
        Triple(MINUTE, StakingCopy.durationMinute, StakingCopy.durationMinutes),
    )

private val utcDay = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.US).withZone(ZoneOffset.UTC)
private val utcClock = DateTimeFormatter.ofPattern("HH:mm", Locale.US).withZone(ZoneOffset.UTC)

/** `{name}` placeholders replaced, as the side panel's `t()`. */
fun fill(
    template: String,
    vararg values: Pair<String, String>,
): String = values.fold(template) { text, (key, value) -> text.replace("{$key}", value) }

/** `exitWindowText`: the window rounded down to its largest whole unit ("7 days"). */
fun exitWindow(seconds: ULong): String {
    val unit = units.firstOrNull { seconds >= it.first }
    return if (unit == null) {
        fill(StakingCopy.durationSeconds, "count" to seconds.toString())
    } else {
        val count = seconds / unit.first
        fill(if (count == 1uL) unit.second else unit.third, "count" to count.toString())
    }
}

/** The validator screen's exit-window line, e.g. "Unstaking takes 7 days, with no rewards …". */
fun exitWindowLine(seconds: ULong): String = fill(StakingCopy.validatorExitWindow, "window" to exitWindow(seconds))

/** `unlockText`: the unlock time in fixed UTC, never the device's zone, e.g. 15 Jan 2027, 08:01. */
fun unlockText(seconds: ULong): String {
    val instant = Instant.ofEpochSecond(seconds.toLong())
    return "${utcDay.format(instant)}, ${utcClock.format(instant)}"
}

private fun held(value: String) = value.isNotEmpty() && value != "0"

/**
 * `positionLines`: staked, rewards, a reward address other than this account, and a pending or
 * withdrawable unstake with its UTC unlock time. Empty for no position.
 */
fun positionLines(
    row: StakingRowView,
    amount: (String) -> String,
    address: (String) -> String,
): List<String> {
    val figures = row.figures ?: return emptyList()
    val unpool = amount(figures.unpoolAmount)
    return listOfNotNull(
        fill(StakingCopy.positionStaked, AMOUNT to amount(figures.staked), SYMBOL to row.symbol)
            .takeIf { held(figures.staked) },
        fill(StakingCopy.positionRewards, AMOUNT to amount(figures.unclaimed), SYMBOL to "STRK")
            .takeIf { held(figures.unclaimed) },
        figures.rewardsTo?.let { fill(StakingCopy.positionRewardsTo, "address" to address(it)) },
        figures.unpoolTime?.takeIf { figures.state == PositionState.EXIT_PENDING }?.let {
            fill(StakingCopy.positionUnstaking, AMOUNT to unpool, SYMBOL to row.symbol, "time" to unlockText(it))
        },
        fill(StakingCopy.positionReadyToWithdraw, AMOUNT to unpool, SYMBOL to row.symbol)
            .takeIf { figures.state == PositionState.WITHDRAWABLE },
    )
}

/** "Commission 5% · 1,000 STRK delegated". */
fun commissionLine(
    row: StakingRowView,
    figures: RowFigures,
): String =
    fill(
        StakingCopy.validatorCommission,
        "commission" to figures.commission,
        "delegated" to figures.delegated,
        SYMBOL to row.symbol,
    )

/** "Commission 5% · 30-day uptime 99.5%", "unknown" for a figure the directory did not give. */
fun figuresLine(entry: DirectoryEntry): String =
    fill(
        StakingCopy.directoryFigures,
        "commission" to (entry.commission ?: StakingCopy.directoryUnknown),
        "uptime" to (entry.uptime ?: StakingCopy.directoryUnknown),
    )

/** One pool of a directory entry: "1,500 STRK delegated" or "STRK delegated unknown". */
fun poolLine(pool: DirectoryPoolEntry): String =
    pool.delegated?.let { fill(StakingCopy.directoryPool, "delegated" to it, SYMBOL to pool.symbol) }
        ?: fill(StakingCopy.directoryPoolUnknown, SYMBOL to pool.symbol)

/**
 * A refusal or error as the reader sees it: the core's refusal through the extension's friendly
 * copy ([friendlyError]), with [context] the screen's own line for one that says nothing a reader
 * needs; anything that is not a refusal reads the extension's `STAKING_UNREADABLE`
 * ([StakingCopy.readFailed]), so a failed read never reads as "no stakes". Never for the review
 * sentence or a risk line.
 */
fun stakingMessage(
    error: Throwable,
    context: String? = null,
): String = (error as? StakingException.Refused)?.let { friendlyError(it.reason, context) } ?: StakingCopy.readFailed
