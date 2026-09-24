package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus
import org.bramble.core.supportedNetworks
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Exercises the Rust core through the generated Kotlin bindings on a device, as the iOS
 * `CoreBridgeTests`: the same parity fixture the Rust suite uses (copied into the test assets at
 * build time), so a binding or linking fault shows up as a wrong address here.
 */
@RunWith(AndroidJUnit4::class)
class CoreBridgeTest {
    private fun fixture(): JSONObject {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        return JSONObject(assets.open("extension-parity.json").bufferedReader().use { it.readText() })
    }

    private fun core(): WalletCore {
        val dir = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, UUID.randomUUID().toString())
        return WalletCore(dir.absolutePath)
    }

    @Test
    fun parityWithTheExtension() {
        val fixture = fixture()
        val core = core()
        core.importWallet("parity password", fixture.getString("mnemonic"), null)
        core.addAccount(NetworkId.SEPOLIA)
        val vectors = fixture.getJSONArray("accounts")
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            val network = if (vector.getString("networkId") == "SN_MAIN") NetworkId.MAINNET else NetworkId.SEPOLIA
            val index = vector.getInt("accountIndex")
            val account = core.accounts(network)[index]
            assertEquals(vector.getString("address"), account.address)
            assertEquals(vector.getString("publicKeyX"), account.publicKey)
            val signature = core.signHash(index.toUInt(), fixture.getString("messageHash"))
            assertEquals(vector.getString("signatureR"), signature.r)
            assertEquals(vector.getString("signatureS"), signature.s)
        }
    }

    @Test
    fun lockedCoreRefusesKeyOperations() {
        val core = core()
        val phrase = core.createWallet("a strong password", 12u)
        assertEquals(12, phrase.words.size)
        core.lock()
        assertEquals(WalletStatus.LOCKED, core.status())
        assertThrows(CoreException.Locked::class.java) { core.signHash(0u, "0x1") }
        assertThrows(CoreException.WrongPassword::class.java) { core.unlock("wrong password") }
    }

    @Test
    fun bundledNetworksComeFromTheExtensionCatalog() {
        val sepolia = supportedNetworks().first { it.network == NetworkId.SEPOLIA }
        assertEquals("0x534e5f5345504f4c4941", sepolia.chainId)
        assertTrue(sepolia.tokens.any { it.symbol == "STRK" })
    }
}
