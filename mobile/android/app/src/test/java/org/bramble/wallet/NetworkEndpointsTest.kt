package org.bramble.wallet

import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Every RPC read takes its endpoints from the wallet's `networks()` (the override first), and from
 * the bundled catalog only when the core refuses that (no wallet yet, or locked).
 */
class NetworkEndpointsTest {
    private val bundled =
        listOf(info(NetworkId.MAINNET, "https://a.example"), info(NetworkId.SEPOLIA, "https://b.example"))

    private fun info(
        network: NetworkId,
        vararg urls: String,
    ) = NetworkInfo(
        network = network,
        chainId = "0x1",
        explorerBaseUrl = "https://explorer.example",
        name = "name",
        rpcUrls = urls.toList(),
        tokens = emptyList(),
    )

    @Test
    fun anOverrideIsTriedFirst() {
        val wallet = listOf(info(NetworkId.MAINNET, "https://mine.example/KEY", "https://a.example"), bundled[1])
        val picked = endpointNetwork(NetworkId.MAINNET, { wallet }, { bundled })
        assertEquals(listOf("https://mine.example/KEY", "https://a.example"), picked.rpcUrls)
    }

    @Test
    fun lockedOrNoWalletUsesBundled() {
        val picked = endpointNetwork(NetworkId.SEPOLIA, { error("locked") }, { bundled })
        assertEquals(listOf("https://b.example"), picked.rpcUrls)
    }
}
