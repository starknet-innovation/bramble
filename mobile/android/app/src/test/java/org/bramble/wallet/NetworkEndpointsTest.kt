package org.bramble.wallet

import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.NetworkInfo
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Every RPC read takes its endpoints from the wallet's `networks()` (the override first), and from
 * the bundled catalog only before a wallet exists; with a wallet but no session, from none at all.
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
    fun noWalletUsesBundled() {
        val picked = endpointNetwork(NetworkId.SEPOLIA, { throw CoreException.NoWallet() }, { bundled })
        assertEquals(listOf("https://b.example"), picked.rpcUrls)
    }

    @Test
    fun lockedFailsClosed() {
        val picked = endpointNetwork(NetworkId.SEPOLIA, { throw CoreException.Locked() }, { bundled })
        assertEquals(emptyList<String>(), picked.rpcUrls)
        assertEquals(NetworkId.SEPOLIA, picked.network)
    }
}
