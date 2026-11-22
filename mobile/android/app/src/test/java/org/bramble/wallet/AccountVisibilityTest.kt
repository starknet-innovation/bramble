package org.bramble.wallet

import org.bramble.core.AccountFamily
import org.bramble.core.AccountRecord
import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.UnusableAccount
import org.bramble.core.UnusableReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Hidden and kept accounts as the apps render them: hidden records leave the lists
 * the drawer, Send and Manage show and come back under "Hidden accounts"; the core's refusal to
 * hide the last visible account reads as the extension words it; and every kept reason has its
 * own line.
 */
class AccountVisibilityTest {
    private fun account(
        index: Int,
        hidden: Boolean = false,
        preFixReadyKey: Boolean = false,
    ) = AccountRecord(
        id = "SN_MAIN:0x$index",
        network = NetworkId.MAINNET,
        family = AccountFamily.ARGENT,
        classHash = "0x1",
        accountIndex = index.toUInt(),
        address = "0x$index",
        publicKey = "0x1",
        deploymentSalt = "0x1",
        label = null,
        displayName = "Account $index",
        shortAddress = "0x$index",
        typeLabel = null,
        authorizationShape = "argent-signer-array",
        groupId = null,
        active = index == 0,
        hidden = hidden,
        imported = false,
        preFixReadyKey = preFixReadyKey,
    )

    @Test
    fun hiddenLeaveTheLists() {
        val records = listOf(account(0), account(1, hidden = true), account(2), account(3, hidden = true))
        assertEquals(listOf("SN_MAIN:0x0", "SN_MAIN:0x2"), records.visible().map { it.id })
        assertEquals(listOf("SN_MAIN:0x1", "SN_MAIN:0x3"), records.hidden().map { it.id })
    }

    @Test
    fun refusalIsTheExtensionsWords() {
        assertEquals(
            "Can't hide the last account on this network",
            describe(CoreException.InvalidInput("can't hide the last account on this network")),
        )
    }

    @Test
    fun everyKeptReasonHasALine() {
        val lines =
            UnusableReason.entries.map { reason ->
                unusableReasonText(UnusableAccount("SN_DEVNET:0x1", "SN_DEVNET", "0x1", "0x1…0x1", reason))
            }
        assertEquals(UnusableReason.entries.size, lines.toSet().size)
        assertTrue(lines.all { it.isNotBlank() })
        assertTrue("names the network mobile lacks", lines[UnusableReason.OTHER_NETWORK.ordinal].contains("SN_DEVNET"))
    }
}
