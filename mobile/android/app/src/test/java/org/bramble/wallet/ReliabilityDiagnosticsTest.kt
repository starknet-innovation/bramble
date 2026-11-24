package org.bramble.wallet

import org.bramble.core.HttpOutcome
import org.bramble.core.NetworkId
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URL

/** Reliability diagnostics: off by default, cleared when turned off, and fixed labels only. */
class ReliabilityDiagnosticsTest {
    private val secretHost =
        URL("https://rpc.alice-0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d.example/key")

    @After
    fun off() {
        ReliabilityDiagnostics.enabled = false
    }

    private fun report() = ReliabilityDiagnostics.report(2, NetworkId.MAINNET, "0.1.0")

    @Test
    fun offByDefaultRecordsNothing() {
        assertFalse(ReliabilityDiagnostics.enabled)
        ReliabilityDiagnostics.recordRpc(URL("https://wallet.nodes.starknet.org/rpc"), 200, false, 10)
        assertTrue(report().contains(""""rpc":[]"""))
    }

    @Test
    fun countsAndClearsWhenOff() {
        ReliabilityDiagnostics.enabled = true
        ReliabilityDiagnostics.recordRpc(URL("https://wallet.nodes.starknet.org/rpc"), 200, false, 10)
        ReliabilityDiagnostics.recordRpc(URL("https://wallet.nodes.starknet.org/rpc"), 200, false, 30)
        ReliabilityDiagnostics.recordRpc(URL("https://sepolia.nodes.starknet.org/rpc"), 429, false, 5)
        ReliabilityDiagnostics.recordRpc(secretHost, 0, true, 15_000)
        ReliabilityDiagnostics.recordExplorer(
            HttpOutcome(200u, null, ByteArray(0), false),
            applied = false,
            elapsedMs = 7,
        )
        val text = report()
        assertTrue(text, text.contains("""{"count":2,"endpoint":"wallet-gateway","latencyMs":20,"outcome":"ok"}"""))
        assertTrue(text, text.contains(""""endpoint":"foundation","latencyMs":5,"outcome":"rate-limited""""))
        assertTrue(text, text.contains(""""endpoint":"custom","latencyMs":15000,"outcome":"timeout""""))
        assertTrue(text, text.contains(""""outcome":"invalid-response","service":"starkscan""""))
        ReliabilityDiagnostics.enabled = false
        assertTrue(report().contains(""""rpc":[]"""))
        assertTrue(report().contains(""""explorer":[]"""))
    }

    @Test
    fun reportHoldsOnlyFixedFields() {
        ReliabilityDiagnostics.enabled = true
        ReliabilityDiagnostics.recordRpc(secretHost, 500, false, 1)
        val text = report()
        for (forbidden in listOf("alice", "0x", "example", "key", "https", "address", "amount", "phrase", "note")) {
            assertFalse("$forbidden in $text", text.contains(forbidden, ignoreCase = true))
        }
        val keys = Regex("\"([A-Za-z]+)\":").findAll(text).map { it.groupValues[1] }.toSet()
        assertEquals(
            setOf(
                "build",
                "platform",
                "version",
                "diagnostics",
                "accountCount",
                "collectionEnabled",
                "explorer",
                "networkId",
                "rpc",
                "count",
                "endpoint",
                "latencyMs",
                "outcome",
            ),
            keys,
        )
    }
}
