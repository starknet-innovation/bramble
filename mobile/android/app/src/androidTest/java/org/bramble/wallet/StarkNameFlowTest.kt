package org.bramble.wallet

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.bramble.core.NetworkId
import org.bramble.core.WalletCore
import org.bramble.core.supportedNetworks
import org.bramble.core.validateRecipient
import org.bramble.wallet.security.DeviceClock
import org.bramble.wallet.send.RecipientBook
import org.bramble.wallet.send.SendFlowModel
import org.bramble.wallet.send.continueWithTyped
import org.bramble.wallet.send.updateRecipient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * A typed Starknet name on Send through the real core (as iOS `StarkNameLookupTests`): it
 * resolves under its canonical spelling, and an answer that lands after the field or the network
 * moved on is dropped. The node is a stub that never leaves the device.
 */
@RunWith(AndroidJUnit4::class)
class StarkNameFlowTest {
    private val sepolia = supportedNetworks().first { it.network == NetworkId.SEPOLIA }
    private var onCall: () -> Unit = {}

    private val node =
        RpcPost { _, body, _ ->
            val request = JSONObject(body)
            val result =
                when (request.getString("method")) {
                    "starknet_chainId" -> sepolia.chainId
                    "starknet_call" -> JSONArray(listOf(RESOLVED)).also { onCall() }
                    else -> error("unexpected ${request.getString("method")}")
                }
            JSONObject()
                .put("jsonrpc", "2.0")
                .put("id", request.getLong("id"))
                .put("result", result)
                .toString()
        }

    private fun model(): SendFlowModel {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.cacheDir, UUID.randomUUID().toString())
        val core = WalletCore(dir.absolutePath, DeviceClock(context.contentResolver))
        core.createWalletOnNetwork("a strong password", 12u, NetworkId.SEPOLIA)
        return SendFlowModel(core, sepolia, core.activeAccount()!!, emptyMap(), transport = node)
    }

    @Test
    fun nameResolvesStaleIsDropped() =
        runBlocking {
            val model = model()
            val empty = RecipientBook(emptyList(), emptyList())
            model.updateRecipient(" Fricoben.STARK ")
            model.continueWithTyped(empty) { NetworkId.SEPOLIA }
            assertEquals(SendFlowModel.Stage.DETAILS, model.stage)
            assertEquals(validateRecipient(RESOLVED), model.recipient)
            assertEquals("fricoben.stark", model.recipientLabel)
            assertEquals(SendFlowModel.ResolvedName(isNew = true), model.resolvedName)

            val edited = model()
            onCall = { edited.updateRecipient("fricoben2.stark") }
            edited.updateRecipient("fricoben.stark")
            edited.continueWithTyped(empty) { NetworkId.SEPOLIA }
            assertEquals(SendFlowModel.Stage.RECIPIENT, edited.stage)
            assertNull(edited.recipient)

            onCall = {}
            val moved = model()
            moved.updateRecipient("fricoben.stark")
            moved.continueWithTyped(empty) { NetworkId.MAINNET }
            assertNull("the wallet left the network the name was read on", moved.recipient)
        }

    private companion object {
        const val RESOLVED = "0x123abc"
    }
}
