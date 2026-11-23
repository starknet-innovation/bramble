package org.bramble.wallet.coordination

import org.bramble.core.RelayStep
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The relay loop's answer to each core step ([followRelayStep]): a next page closes the full
 * subscription and opens the older one on the same socket, in that order, and keeps reading.
 */
class RelayStepTest {
    private fun follow(step: RelayStep): Pair<RelayRead, List<String>> {
        val sent = mutableListOf<String>()
        return followRelayStep(step) { sent += it } to sent
    }

    @Test
    fun nextPageClosesThenRequests() {
        val close = """["CLOSE","mcw-1"]"""
        val request = """["REQ","mcw-2",{"until":1750000000}]"""
        assertEquals(RelayRead.PAGE_REQUESTED to listOf(close, request), follow(RelayStep.NextPage(close, request)))
    }

    @Test
    fun finishSendsItsCloseFrame() {
        val close = """["CLOSE","mcw-1"]"""
        assertEquals(RelayRead.FINISHED to listOf(close), follow(RelayStep.Finish(close)))
        assertEquals(RelayRead.FINISHED to emptyList<String>(), follow(RelayStep.Finish(null)))
    }

    @Test
    fun continueSendsNothing() {
        assertEquals(RelayRead.KEEP_READING to emptyList<String>(), follow(RelayStep.Continue))
    }
}
