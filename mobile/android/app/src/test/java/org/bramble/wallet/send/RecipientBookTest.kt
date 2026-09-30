package org.bramble.wallet.send

import org.bramble.core.AccountFamily
import org.bramble.core.AccountGroup
import org.bramble.core.AccountRecord
import org.bramble.core.Contact
import org.bramble.core.NetworkId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Send recipient stage's lists (`recipientStage`): the address book, then the person's
 * accounts under their folders with the unfiled ones first, no empty folder, the sending account
 * marked current, and a search that reaches every row and drops folders it empties.
 */
class RecipientBookTest {
    private val savings = AccountGroup("savings", "Savings", "piggy-bank", listOf("SN_MAIN:${ADDRESS_PREFIX}2"))
    private val empty = AccountGroup("empty", "Empty", "folder", emptyList())
    private val friend = Contact("c1", "Alice", NetworkId.MAINNET, "${ADDRESS_PREFIX}9", null, null)
    private val accounts =
        listOf(account(0, "Amber Otter"), account(1, "Brisk Heron"), account(2, "Calm Lynx", "savings"))
    private val book = recipientBook(accounts, listOf(savings, empty), listOf(friend), currentId = accounts[0].id)

    private fun account(
        index: Int,
        name: String,
        group: String? = null,
    ) = AccountRecord(
        id = "SN_MAIN:${ADDRESS_PREFIX}$index",
        network = NetworkId.MAINNET,
        family = AccountFamily.OPEN_ZEPPELIN,
        classHash = CLASS_HASH,
        accountIndex = index.toUInt(),
        address = "${ADDRESS_PREFIX}$index",
        publicKey = CLASS_HASH,
        deploymentSalt = null,
        label = null,
        displayName = name,
        shortAddress = "0x0${index}ab…cdef",
        typeLabel = null,
        authorizationShape = "stark-pair",
        groupId = group,
        viewOnly = false,
        active = index == 0,
    )

    @Test
    fun contactsThenNonEmptyFolders() {
        assertEquals(listOf(RecipientRow("Alice", "${ADDRESS_PREFIX}9")), book.contacts)
        assertEquals(listOf(SendCopy.myAccounts, "Savings"), book.folders.map { it.name })
        assertEquals(listOf("Amber Otter", "Brisk Heron"), book.folders[0].rows.map { it.label })
        assertEquals("wallet", book.folders[0].icon)
        assertEquals("piggy-bank", book.folders[1].icon)
    }

    @Test
    fun marksTheSendingAccountCurrent() {
        assertEquals(listOf(true, false), book.folders[0].rows.map { it.current })
    }

    @Test
    fun namesAListedAddressOnly() {
        assertEquals("Alice", book.labelFor("${ADDRESS_PREFIX}9"))
        assertEquals("Calm Lynx", book.labelFor("${ADDRESS_PREFIX}2"))
        assertNull(book.labelFor("${ADDRESS_PREFIX}7"))
    }

    @Test
    fun searchDropsEmptiedFolders() {
        val lynx = book.filtered("  LYNX ")
        assertEquals(emptyList<RecipientRow>(), lynx.contacts)
        assertEquals(listOf("Savings"), lynx.folders.map { it.name })
        assertEquals(book, book.filtered(" "))
        assertTrue(book.filtered("nobody").isEmpty)
        assertEquals(listOf("Alice"), book.filtered("${ADDRESS_PREFIX}9").contacts.map { it.label })
    }

    private companion object {
        const val ADDRESS_PREFIX = "0x5b7c2e1f00000000000000000000000000000000000000000000000000c0ff"
        const val CLASS_HASH = "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f"
    }
}
