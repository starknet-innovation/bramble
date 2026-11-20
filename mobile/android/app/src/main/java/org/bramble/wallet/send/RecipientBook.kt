package org.bramble.wallet.send

import org.bramble.core.AccountGroup
import org.bramble.core.AccountRecord
import org.bramble.core.Contact

/**
 * One row the Send recipient stage lists: a saved contact, or one of the person's accounts.
 *
 * @property label the name shown, and carried to the review: the contact's label or the account's
 *   display name, never typed text.
 * @property address the core's canonical address, the value picked.
 * @property current true for the sending account's own row ("Current").
 */
data class RecipientRow(
    val label: String,
    val address: String,
    val current: Boolean = false,
)

/**
 * One folder of the person's accounts, as the account drawer files them.
 *
 * @property name the folder's name ("My accounts" for accounts in no folder).
 * @property icon the folder's icon name, as the core's `groupIcons()` spell it.
 * @property rows the folder's accounts on this network, in the core's order.
 */
data class RecipientFolder(
    val name: String,
    val icon: String,
    val rows: List<RecipientRow>,
)

/**
 * What the recipient stage lists (`send-recipient-view.ts` `recipientStage`): the address book,
 * then the person's accounts under their folders, the sending account included. Every address is
 * in one form, the core's `validateRecipient` answer (account records already are; the store puts
 * contacts in it), so the lookups compare them as they are.
 *
 * @property contacts the saved contacts on this network.
 * @property folders the non-empty folders, the unfiled accounts' "My accounts" first.
 */
data class RecipientBook(
    val contacts: List<RecipientRow>,
    val folders: List<RecipientFolder>,
) {
    /** Every listed row: the contacts, then each folder's accounts. */
    val rows: List<RecipientRow> get() = contacts + folders.flatMap { it.rows }

    /** True when nothing is listed. */
    val isEmpty: Boolean get() = contacts.isEmpty() && folders.isEmpty()
}

/** The name of the row [address] belongs to, or null when no row lists it. */
fun RecipientBook.labelFor(address: String): String? = rows.firstOrNull { it.address == address }?.label

/**
 * The rows whose name or address contains [query] (trimmed, any case), as the extension's search;
 * a folder with nothing left drops out. A blank query keeps everything.
 */
fun RecipientBook.filtered(query: String): RecipientBook {
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return this
    val matches = { row: RecipientRow -> "${row.label} ${row.address}".lowercase().contains(needle) }
    return RecipientBook(
        contacts.filter(matches),
        folders.mapNotNull { folder ->
            folder.copy(rows = folder.rows.filter(matches)).takeIf { it.rows.isNotEmpty() }
        },
    )
}

/**
 * The book for one network: [contacts] as saved, and [accounts] split across [groups] the way the
 * drawer splits them (an account in no known folder is listed under [homeName], first). Empty
 * folders are not listed; the account with [currentId] is marked current.
 */
fun recipientBook(
    accounts: List<AccountRecord>,
    groups: List<AccountGroup>,
    contacts: List<Contact>,
    currentId: String?,
    homeName: String = SendCopy.myAccounts,
): RecipientBook {
    val row = { record: AccountRecord -> RecipientRow(record.displayName, record.address, record.id == currentId) }
    val filed = groups.associateWith { group -> accounts.filter { it.groupId == group.id } }
    val home = accounts.filter { record -> groups.none { it.id == record.groupId } }
    val folders =
        listOf(RecipientFolder(homeName, HOME_ICON, home.map(row))) +
            filed.map { (group, members) -> RecipientFolder(group.name, group.icon, members.map(row)) }
    return RecipientBook(
        contacts.map { RecipientRow(it.label, it.address) },
        folders.filter { it.rows.isNotEmpty() },
    )
}

/** The home folder's icon, as the extension's default "My accounts" group. */
private const val HOME_ICON = "wallet"
