package org.bramble.wallet.coordination

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.bramble.core.Contact
import org.bramble.core.ContactCardParse
import org.bramble.core.CoreException
import org.bramble.core.NetworkId
import org.bramble.core.walletContactCardParse
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress

// Compose counterparts of the iOS coordination screens, with the extension's copy, built from the
// design-mobile components (FlowHeader, menu groups, flat fields, pills, CopyButton). Public
// fields use `SecretKind.ADDRESS` (no suggestions, readable). Success is a positive toast
// (`showNotice`); errors stay on the screen's status line. The Receive card and identity live in
// `ui/wallet/ReceiveScreen.kt`.

/** A muted caption line. */
@Composable
internal fun Caption(text: String) =
    Text(text, color = LocalSkin.current.muted, style = textStyle(BrambleTypeScale.caption))

/** A menu-row title. */
@Composable
internal fun RowTitle(text: String) =
    Text(text, color = LocalSkin.current.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.medium))

/** A flow screen: the shared header, then [content] with the screen gap. */
@Composable
internal fun Page(
    store: WalletStore,
    title: String,
    subtitle: String?,
    back: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader(title, subtitle = subtitle, network = store.networkLabel, back = back)
        content()
    }
}

/** The address book form's fields, held together so a save can clear them in one place. */
private class ContactDraft {
    var cardText by mutableStateOf("")
    var cardInvalid by mutableStateOf(false)
    var label by mutableStateOf("")
    var address by mutableStateOf("")
    var nostr by mutableStateOf("")
    var signer by mutableStateOf("")
    var result by mutableStateOf<String?>(null)

    /**
     * A pasted wallet card: a valid one for [network] fills the address and both keys; any other
     * marks the field invalid. Clearing the field clears only the invalid mark.
     */
    fun pasteCard(
        value: String,
        network: NetworkId,
    ) {
        cardText = value
        if (value.isBlank()) {
            cardInvalid = false
            return
        }
        val parsed = walletContactCardParse(value.trim(), network)
        if (parsed is ContactCardParse.Valid) {
            address = parsed.card.address
            signer = parsed.card.publicKeyX.orEmpty()
            nostr = parsed.card.nostrPublicKey.orEmpty()
        }
        cardInvalid = parsed !is ContactCardParse.Valid
        result = cardStatus(parsed)
    }

    /** After a save: the status line and every field are emptied. */
    fun clear() {
        result = null
        cardText = ""
        label = ""
        address = ""
        signer = ""
        nostr = ""
    }
}

/** The status copy for a pasted wallet card. */
private fun cardStatus(parsed: ContactCardParse): String =
    when (parsed) {
        is ContactCardParse.Valid -> "Wallet card verified. Add a label, then save."
        is ContactCardParse.OtherNetwork -> "This wallet card belongs to a different network."
        else -> "That wallet card is not recognized."
    }

private const val CARD_HINT =
    "Paste a shared Bramble card to fill the address, signer key, and coordination identity together."

/** `address-book`: paste a wallet card or type the fields; saved contacts for this network. */
@Composable
fun AddressBookScreen(
    store: WalletStore,
    back: () -> Unit,
) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    // A typed recipient Send offered to save arrives as the address, for a label to be added.
    val draft =
        remember {
            ContactDraft().apply {
                coordination.contactDraft?.let { address = it }
                coordination.contactDraft = null
            }
        }
    LaunchedEffect(Unit) { coordination.refresh() }
    Page(store, "Address book", "${coordination.contacts.size} saved", back) {
        ContactFields(store, draft)
        PillButton(
            "Save address",
            kind = PillKind.SECONDARY,
            icon = BrambleIconName.CHECK,
            enabled = !draft.cardInvalid,
        ) {
            scope.launch {
                runCatching {
                    coordination.saveContact(
                        draft.label,
                        draft.address.trim(),
                        draft.signer.trim().ifEmpty { null },
                        draft.nostr.trim().ifEmpty { null },
                    )
                }.onSuccess {
                    store.showNotice("Address saved")
                    draft.clear()
                }.onFailure { draft.result = describe(it) }
            }
        }
        StatusLine(draft.result, if (draft.cardInvalid) StatusTone.DANGER else StatusTone.MUTED)
        Eyebrow("Saved addresses")
        SavedContacts(store) { contact ->
            scope.launch {
                runCatching {
                    coordination.removeContact(
                        contact.id,
                    )
                }.onFailure(store::showError)
            }
        }
    }
}

/** The wallet-card field, the four contact fields, and the update note. */
@Composable
private fun ContactFields(
    store: WalletStore,
    draft: ContactDraft,
) {
    BrambleField(
        "Wallet card (optional)",
        "mcw:contact:1:…",
        draft.cardText,
        { value -> draft.pasteCard(value, store.network) },
        kind = SecretKind.ADDRESS,
        invalid = draft.cardInvalid,
        hint = CARD_HINT,
    )
    BrambleField("Label", "", draft.label, { draft.label = it }, kind = SecretKind.ADDRESS)
    BrambleField("Address", "0x…", draft.address, { draft.address = it }, kind = SecretKind.ADDRESS)
    BrambleField(
        "Coordination public key (optional)",
        "64-character Nostr public key",
        draft.nostr,
        { draft.nostr = it },
        kind = SecretKind.ADDRESS,
        hint = "Authenticates encrypted multisig intent handoffs from this contact.",
    )
    BrambleField(
        "Signer public key (optional)",
        "0x…",
        draft.signer,
        { draft.signer = it },
        kind = SecretKind.ADDRESS,
        hint = "Lets this contact appear in multisig signer pickers.",
    )
    Caption("Saving an existing address updates its label.")
}

/** This network's saved contacts, each with copy and remove; [remove] runs the removal. */
@Composable
private fun SavedContacts(
    store: WalletStore,
    remove: (Contact) -> Unit,
) {
    val contacts = store.coordination.contacts
    if (contacts.isEmpty()) {
        Caption("No saved addresses yet. Save one to reuse it when sending.")
        return
    }
    MenuGroup {
        contacts.forEachIndexed { offset, contact ->
            if (offset > 0) MenuDivider()
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = BrambleLayout.menuRowMin)
                    .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            ) {
                Column(
                    Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap),
                ) {
                    RowTitle(contact.label)
                    Caption(shortAddress(contact.address))
                    contact.publicKeyX?.let { Caption("Signer key ${shortAddress(it)}") }
                    if (contact.nostrPublicKey != null) Caption("Secure coordination ready")
                }
                CopyButton(store, contact.address, "Copy ${contact.label}")
                IconButton(BrambleIconName.X, "Remove ${contact.label}", tint = LocalSkin.current.danger) {
                    remove(contact)
                }
            }
        }
    }
}

private const val RELAY_HINT =
    "Used across networks for encrypted intent handoffs. Every co-signer must select the same relay. " +
        "Leave empty for the reviewed defaults."

/** Settings → Network → "Multisig coordination relay". */
@Composable
fun CoordinationRelaySettings(store: WalletStore) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var relay by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { coordination.refresh() }
    Disclosure(
        "Multisig coordination relay",
        open = open,
        onToggle = { open = !open },
        detail = if (coordination.relayPolicy?.isCustom == true) "Custom" else "Reviewed defaults",
    ) {
        BrambleField(
            "Custom Nostr relay",
            "wss://relay.example",
            relay,
            { relay = it },
            kind = SecretKind.ADDRESS,
            hint = RELAY_HINT,
        )
        PillButton("Save coordination relay", kind = PillKind.SECONDARY, icon = BrambleIconName.CHECK) {
            scope.launch {
                runCatching { coordination.setRelay(relay) }
                    .onSuccess {
                        store.showNotice(it)
                        error = null
                    }.onFailure { error = relayError(it) }
            }
        }
        StatusLine(error, StatusTone.DANGER)
    }
}

/** The relay form's error copy for a failed save. */
private fun relayError(failure: Throwable): String =
    when {
        failure is CoreException.InvalidInput &&
            failure.reason.contains(
                "wss",
            ) -> "Mobile connects to secure relays only (wss://)."

        failure is CoreException.InvalidInput -> "Invalid Nostr relay endpoint"

        else -> "Coordination relay update failed"
    }
