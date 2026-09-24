package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import org.bramble.core.AccountFamily
import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.RecoverySelection
import org.bramble.core.WalletCore
import org.bramble.core.WalletStatus
import org.bramble.core.supportedNetworks
import org.bramble.wallet.security.DeviceClock
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.cacheDir, UUID.randomUUID().toString())
        return WalletCore(dir.absolutePath, DeviceClock(context.contentResolver))
    }

    @Test
    fun parityWithTheExtension() {
        val fixture = fixture()
        val core = core()
        // An import is recovery pending with no accounts until discovery restores some (as
        // mobile/core/tests/parity.rs): restore OpenZeppelin 0 and 1, then project the active one
        // onto Mainnet, which is how the Mainnet vectors' records come to exist.
        core.importWallet("parity password", fixture.getString("mnemonic"), null)
        val oz = { index: UInt -> RecoverySelection(AccountFamily.OPEN_ZEPPELIN, index, null) }
        val restored = core.restoreRecoveredAccounts(NetworkId.SEPOLIA, listOf(oz(0u), oz(1u)))
        core.selectAccount(restored.first().id)
        core.ensureNetworkAccount(NetworkId.MAINNET)
        val vectors = fixture.getJSONArray("accounts")
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            val network = if (vector.getString("networkId") == "SN_MAIN") NetworkId.MAINNET else NetworkId.SEPOLIA
            val index = vector.getInt("accountIndex").toUInt()
            val account = core.accountRecords(network).first { it.accountIndex == index }
            assertEquals(vector.getString("address"), account.address)
            assertEquals(vector.getString("classHash"), account.classHash)
            assertEquals(vector.getString("publicKeyX"), account.publicKey)
            // Signing is by account record, never by index.
            val signature = core.signHashForAccount(account.id, fixture.getString("messageHash"))
            assertEquals(vector.getString("publicKeyX"), signature.publicKey)
            assertEquals(vector.getString("signatureR"), signature.r)
            assertEquals(vector.getString("signatureS"), signature.s)
        }
    }

    @Test
    fun lockedCoreRefusesKeyOperations() {
        val core = core()
        val phrase = core.createWallet("a strong password", 12u)
        assertEquals(12, phrase.words.size)
        val account = core.activeAccount()!!
        core.lock()
        assertEquals(WalletStatus.LOCKED, core.status())
        assertThrows(CoreException.Locked::class.java) { core.signHashForAccount(account.id, "0x1") }
        assertThrows(CoreException.WrongPassword::class.java) { core.unlock("wrong password") }
    }

    @Test
    fun wrongPassphrasesAreCountedAndThenThrottled() {
        val core = core()
        core.createWallet("a strong password", 12u)
        core.lock()
        repeat(5) { assertThrows(CoreException.WrongPassword::class.java) { core.unlock("wrong password") } }
        val status = core.securityStatus()
        assertEquals(5u, status.failedAttempts)
        assertTrue("the fifth failure starts a delay", status.retryAfterMs > 0uL)
        assertThrows(CoreException.Throttled::class.java) { core.unlock("a strong password") }
        assertEquals(WalletStatus.LOCKED, core.status())
    }

    @Test
    fun biometricSlotOpensOnlyWithItsWrapSecret() {
        val core = core()
        core.createWallet("a strong password", 12u)
        val secret = ByteArray(32) { it.toByte() }
        core.enableBiometricUnlock("a strong password", secret, null)
        assertTrue(core.securityStatus().biometricEnabled)
        core.lock()
        core.unlockWithBiometric(secret)
        assertEquals(WalletStatus.UNLOCKED, core.status())
        core.lock()
        assertThrows(CoreException.BiometricInvalidated::class.java) { core.unlockWithBiometric(ByteArray(32)) }
        assertFalse("a wrong secret drops the slot", core.securityStatus().biometricEnabled)
    }

    @Test
    fun bundledNetworksComeFromTheExtensionCatalog() {
        val sepolia = supportedNetworks().first { it.network == NetworkId.SEPOLIA }
        assertEquals("0x534e5f5345504f4c4941", sepolia.chainId)
        assertTrue(sepolia.tokens.any { it.symbol == "STRK" })
    }
}
