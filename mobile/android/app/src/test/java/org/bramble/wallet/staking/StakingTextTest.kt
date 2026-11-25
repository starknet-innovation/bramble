package org.bramble.wallet.staking

import org.bramble.core.DirectoryEntry
import org.bramble.core.DirectoryPoolEntry
import org.bramble.core.PositionState
import org.bramble.core.RowFigures
import org.bramble.core.StakingAction
import org.bramble.core.StakingException
import org.bramble.core.StakingRowView
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The staking screens' wording (iOS `StakingModelTests`' pure half) against the extension's
 * `staking-views.ts`, `staking-position-lines.ts` and `staking-directory-views.ts`: the exit window
 * in its largest whole unit, the unlock time in fixed UTC, the position lines, the actions a
 * state offers, and the core's refusal shown verbatim.
 */
class StakingTextTest {
    private fun row(
        state: PositionState,
        staked: String = "0",
        unclaimed: String = "0",
        unpool: String = "0",
        unpoolTime: ULong? = null,
        rewardsTo: String? = null,
    ) = StakingRowView(
        staker = "0x5a2",
        symbol = "STRK",
        tokenId = "SN_MAIN:STRK",
        figures =
            RowFigures(
                accepting = true,
                commission = "10%",
                delegated = "1,000",
                rewardsTo = rewardsTo,
                staked = staked,
                state = state,
                unclaimed = unclaimed,
                unpoolAmount = unpool,
                unpoolTime = unpoolTime,
            ),
        refusal = null,
    )

    private fun lines(row: StakingRowView) = positionLines(row, { it }, { "addr($it)" })

    @Test
    fun exitWindowRoundsDown() {
        assertEquals("7 days", exitWindow(604_800uL))
        assertEquals("1 hour", exitWindow(3_600uL))
        assertEquals("2 minutes", exitWindow(150uL))
        assertEquals("59 seconds", exitWindow(59uL))
        assertEquals("Unstaking takes 7 days, with no rewards while you wait.", exitWindowLine(604_800uL))
    }

    @Test
    fun unlockTimeIsFixedUtc() {
        assertEquals("15 Jan 2027, 08:01", unlockText(1_800_000_060uL))
    }

    @Test
    fun positionLinesMatch() {
        assertEquals(
            listOf("Staked 5 STRK", "Rewards 0.25 STRK", "Rewards are paid to addr(0x777)"),
            lines(row(PositionState.STAKED, staked = "5", unclaimed = "0.25", rewardsTo = "0x777")),
        )
        assertEquals(
            listOf("Unstaking 3 STRK · withdraw from 15 Jan 2027, 08:01"),
            lines(row(PositionState.EXIT_PENDING, unpool = "3", unpoolTime = 1_800_000_060uL)),
        )
        assertEquals(listOf("3 STRK ready to withdraw"), lines(row(PositionState.WITHDRAWABLE, unpool = "3")))
        assertEquals(emptyList<String>(), lines(row(PositionState.NOT_STAKED)))
    }

    @Test
    fun stateOffersActions() {
        assertEquals(listOf(StakingAction.CLAIM), rowButtons(row(PositionState.STAKED, unclaimed = "1").figures))
        assertEquals(listOf(StakingAction.CANCEL_UNSTAKE), rowButtons(row(PositionState.EXIT_PENDING).figures))
        assertEquals(
            listOf(StakingAction.WITHDRAW, StakingAction.CANCEL_UNSTAKE),
            rowButtons(row(PositionState.WITHDRAWABLE).figures),
        )
        assertEquals(emptyList<StakingAction>(), rowButtons(null))
    }

    @Test
    fun unknownFiguresSayUnknown() {
        val entry =
            DirectoryEntry(
                commission = null,
                name = null,
                pools = listOf(DirectoryPoolEntry(delegated = null, symbol = "STRK")),
                staker = "0x5a2",
                uptime = "99.5%",
                website = null,
            )
        assertEquals("Commission unknown · 30-day uptime 99.5%", figuresLine(entry))
        assertEquals("STRK delegated unknown", poolLine(entry.pools.first()))
    }

    @Test
    fun aRefusalIsTheCoresSentence() {
        assertEquals("No rewards to claim.", stakingMessage(StakingException.Refused("No rewards to claim.")))
        assertEquals(STAKING_READ_FAILED, stakingMessage(StakingException.Storage()))
    }
}
