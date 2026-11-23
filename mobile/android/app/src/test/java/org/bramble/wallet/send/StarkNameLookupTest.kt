package org.bramble.wallet.send

import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.bramble.core.StarkNameAnswer
import org.bramble.wallet.RpcPost
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException
import java.net.URL

/**
 * Starknet names on Send (wallet-core's PLAN.md P5): each endpoint proves the chain before it is
 * asked the name, `TryNextEndpoint` and transport faults fail over, a node's own answer stops, and
 * with no endpoint left the lookup fails closed. The JVM suite has no native core, so the core's
 * calls are stood in for; `StarkNameFlowTest` (instrumented) runs the real ones.
 */
class StarkNameLookupTest {
    private val urls = listOf("https://a.example", "https://b.example", "https://c.example")
    private val network =
        NetworkInfo(
            network = NetworkId.SEPOLIA,
            chainId = "0x534e5f5345504f4c4941",
            explorerBaseUrl = "https://explorer.example",
            name = "Sepolia",
            rpcUrls = urls,
            tokens = emptyList(),
        )

    /** A node per endpoint: "down" throws, "other" serves another chain, else [answers] by URL. */
    private class Node(
        val down: Set<String> = emptySet(),
        val other: Set<String> = emptySet(),
        val answers: Map<String, StarkNameAnswer> = emptyMap(),
    ) : RpcPost {
        val asked = mutableListOf<Pair<String, String>>()

        override fun post(
            url: URL,
            body: String,
            write: Boolean,
        ): String {
            asked += url.toString() to body
            if (url.toString() in down) throw IOException("down")
            return if (body == "chain") (if (url.toString() in other) "other" else "sepolia") else url.toString()
        }
    }

    private fun calls(node: Node) =
        StarkNameCalls(
            chainRequest = { "chain" },
            verifyChain = { reply, _, _ -> reply == "sepolia" },
            request = { _, _, name -> "name:$name" },
            judge = { reply, _ -> node.answers[reply] ?: StarkNameAnswer.TryNextEndpoint },
        )

    private fun resolve(node: Node) = resolveStarkName("fricoben.stark", network, node, calls(node))

    @Test
    fun chainIsProvenBeforeTheName() {
        val node = Node(down = setOf(urls[0]), other = setOf(urls[1]), answers = mapOf(urls[2] to resolved))
        assertEquals(StarkNameOutcome.Resolved("0x123"), resolve(node))
        assertEquals(listOf(urls[2]), node.asked.filter { it.second.startsWith("name:") }.map { it.first })
    }

    @Test
    fun tryNextEndpointFailsOver() {
        val node = Node(answers = mapOf(urls[1] to resolved))
        assertEquals(StarkNameOutcome.Resolved("0x123"), resolve(node))
    }

    @Test
    fun nodeAnswersStopWithTheirLine() {
        val cases =
            mapOf(
                StarkNameAnswer.NotFound to "No address found for fricoben.stark.",
                StarkNameAnswer.UnsupportedNetwork to "Starknet names are not available on this network.",
                StarkNameAnswer.Failed to "Could not resolve fricoben.stark.",
            )
        for ((answer, line) in cases) {
            val node = Node(answers = mapOf(urls[0] to answer, urls[1] to resolved))
            assertEquals(StarkNameOutcome.Refused(line), resolve(node))
        }
    }

    @Test
    fun noEndpointLeftFailsClosed() {
        assertEquals(
            StarkNameOutcome.Refused("Could not reach the network to resolve fricoben.stark."),
            resolve(Node(down = urls.toSet())),
        )
        assertEquals(StarkNameOutcome.Refused("Could not resolve fricoben.stark."), resolve(Node(other = urls.toSet())))
    }

    private companion object {
        val resolved = StarkNameAnswer.Resolved("0x123")
    }
}
