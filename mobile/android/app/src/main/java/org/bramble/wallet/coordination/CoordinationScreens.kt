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
import org.bramble.core.ContactCardParse
import org.bramble.core.CoreException
import org.bramble.core.MultisigRecord
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
import org.bramble.wallet.design.OptionCard
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
// `ui/wallet/ReceiveScreen.kt`. Uncompiled: there is no Android SDK on the authoring machine.

@Composable
private fun Caption(text: String) =
    Text(text, color = LocalSkin.current.muted, style = textStyle(BrambleTypeScale.caption))

@Composable
private fun RowTitle(text: String) =
    Text(text, color = LocalSkin.current.text, style = textStyle(BrambleTypeScale.row, BrambleWeight.medium))

/** A flow screen: the shared header, then [content] with the screen gap. */
@Composable
private fun Page(store: WalletStore, title: String, subtitle: String?, back: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        FlowHeader(title, subtitle = subtitle, network = store.networkLabel, back = back)
        content()
    }
}

/** `address-book`: paste a wallet card or type the fields; saved contacts for this network. */
@Composable
fun AddressBookScreen(store: WalletStore, back: () -> Unit) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    var cardText by remember { mutableStateOf("") }
    var cardInvalid by remember { mutableStateOf(false) }
    var label by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var nostr by remember { mutableStateOf("") }
    var signer by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { coordination.refresh() }
    Page(store, "Address book", "${coordination.contacts.size} saved", back) {
        BrambleField("Wallet card (optional)", "mcw:contact:1:…", cardText, { value ->
            cardText = value
            if (value.isBlank()) {
                cardInvalid = false
                return@BrambleField
            }
            when (val parsed = walletContactCardParse(value.trim(), store.network)) {
                is ContactCardParse.Valid -> {
                    address = parsed.card.address
                    signer = parsed.card.publicKeyX.orEmpty()
                    nostr = parsed.card.nostrPublicKey.orEmpty()
                    cardInvalid = false
                    result = "Wallet card verified. Add a label, then save."
                }
                is ContactCardParse.OtherNetwork -> { cardInvalid = true; result = "This wallet card belongs to a different network." }
                else -> { cardInvalid = true; result = "That wallet card is not recognized." }
            }
        }, kind = SecretKind.ADDRESS, invalid = cardInvalid,
            hint = "Paste a shared Bramble card to fill the address, signer key, and coordination identity together.")
        BrambleField("Label", "", label, { label = it }, kind = SecretKind.ADDRESS)
        BrambleField("Address", "0x…", address, { address = it }, kind = SecretKind.ADDRESS)
        BrambleField("Coordination public key (optional)", "64-character Nostr public key", nostr, { nostr = it }, kind = SecretKind.ADDRESS,
            hint = "Authenticates encrypted multisig intent handoffs from this contact.")
        BrambleField("Signer public key (optional)", "0x…", signer, { signer = it }, kind = SecretKind.ADDRESS,
            hint = "Lets this contact appear in multisig signer pickers.")
        Caption("Saving an existing address updates its label.")
        PillButton("Save address", kind = PillKind.SECONDARY, icon = BrambleIconName.CHECK, enabled = !cardInvalid) {
            scope.launch {
                runCatching {
                    coordination.saveContact(label, address.trim(), signer.trim().ifEmpty { null }, nostr.trim().ifEmpty { null })
                }.onSuccess {
                    store.showNotice("Address saved")
                    result = null
                    cardText = ""; label = ""; address = ""; signer = ""; nostr = ""
                }.onFailure { result = describe(it) }
            }
        }
        StatusLine(result, if (cardInvalid) StatusTone.DANGER else StatusTone.MUTED)
        Eyebrow("Saved addresses")
        if (coordination.contacts.isEmpty()) {
            Caption("No saved addresses yet. Save one to reuse it when sending.")
        } else {
            MenuGroup {
                coordination.contacts.forEachIndexed { offset, contact ->
                    if (offset > 0) MenuDivider()
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = BrambleLayout.menuRowMin)
                            .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.sm),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
                            RowTitle(contact.label)
                            Caption(shortAddress(contact.address))
                            contact.publicKeyX?.let { Caption("Signer key ${shortAddress(it)}") }
                            if (contact.nostrPublicKey != null) Caption("Secure coordination ready")
                        }
                        CopyButton(store, contact.address, "Copy ${contact.label}")
                        IconButton(BrambleIconName.X, "Remove ${contact.label}", tint = LocalSkin.current.danger) {
                            scope.launch { runCatching { coordination.removeContact(contact.id) }.onFailure(store::showError) }
                        }
                    }
                }
            }
        }
    }
}

private fun configLabel(record: MultisigRecord): String =
    record.threshold?.let { "$it of ${record.signerCount} signers" } ?: "Authority unavailable"

/** `multisig-add`: the Ready Multisig gateway, reached from "Add account". */
@Composable
fun ReadyMultisigScreen(store: WalletStore, back: () -> Unit) {
    var shared by remember { mutableStateOf(false) }
    if (shared) return SharedAccountsScreen(store) { shared = false }
    Page(store, "Ready Multisig", "Multiple signers approve together", back) {
        OptionCard(BrambleIconName.USERS, "Create a multisig", "Set participants, fund, and deploy.") { shared = true }
        OptionCard(BrambleIconName.SEARCH, "Add a shared address", "Sync it or resume setup.") { shared = true }
    }
}

/** `multisigs`: add by address, create a setup, and each saved shared account with its updates. */
@Composable
fun SharedAccountsScreen(store: WalletStore, back: () -> Unit) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var addError by remember { mutableStateOf<String?>(null) }
    var syncResult by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var open by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { coordination.refresh() }
    val records = coordination.multisigs
    Page(store, "Shared accounts", "${records.size} account${if (records.size == 1) "" else "s"}", back) {
        BrambleField("Multisig address", "0x…", address, { address = it }, kind = SecretKind.ADDRESS,
            hint = "If deployed, signer authority syncs from Starknet. If not, the address is saved and deployment setup is verified before use.")
        PillButton("Add shared account", enabled = address.isNotBlank()) {
            scope.launch {
                runCatching { coordination.addShared(address) }
                    .onSuccess { store.showNotice(it); addError = null; address = "" }
                    .onFailure { addError = it.message ?: describe(it) }
            }
        }
        StatusLine(addError, StatusTone.DANGER)
        CreateMultisigSection(store)
        Eyebrow("Shared accounts")
        if (records.isEmpty()) Caption("No shared accounts are saved on this network yet.")
        records.forEach { record ->
            Disclosure(record.name ?: shortAddress(record.address), open = open == record.id,
                onToggle = { open = if (open == record.id) null else record.id }, detail = configLabel(record)) {
                RowTitle("Co-signer updates")
                Caption("Check securely for intents and signatures shared by known contacts.")
                PillButton("Check for updates", kind = PillKind.SECONDARY, icon = BrambleIconName.REFRESH) {
                    scope.launch {
                        val message = runCatching { coordination.sync(record.id) }.fold(
                            { if (it.held == 0u) "No new co-signer updates" else "${it.held} co-signer update${if (it.held == 1u) "" else "s"} received. Open them after the next Bramble update." },
                            { if (it is CoreException.Coordination) "Secure co-signer updates are unavailable. Try again shortly" else "Secure co-signer updates could not be verified. Try again shortly" },
                        )
                        syncResult = syncResult + (record.id to message)
                    }
                }
                StatusLine(syncResult[record.id])
                Caption("Removing stops local tracking only. It never changes the on-chain account.")
                PillButton("Stop watching", kind = PillKind.GHOST) {
                    scope.launch { runCatching { coordination.removeShared(record.id) }.onFailure(store::showError) }
                }
            }
        }
    }
}

/** Create: the active account plus pasted public keys or full wallet cards, then Approval. */
@Composable
private fun CreateMultisigSection(store: WalletStore) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    val account = store.activeRecord ?: return
    var open by remember { mutableStateOf(false) }
    var keys by remember { mutableStateOf(listOf(account.publicKey)) }
    var participant by remember { mutableStateOf("") }
    var threshold by remember { mutableStateOf("1") }
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf<MultisigRecord?>(null) }
    Disclosure("Create a multisig", open = open, onToggle = { open = !open }, detail = "${keys.size} signer${if (keys.size == 1) "" else "s"}") {
        BrambleField("Shared account name (optional)", "", name, { name = it.take(48) }, kind = SecretKind.ADDRESS)
        keys.forEach { Caption("Key ${shortAddress(it)}") }
        BrambleField("Participant public key or wallet card", "0x… or mcw:contact:1:…", participant, { participant = it }, kind = SecretKind.ADDRESS)
        PillButton("Add participant", kind = PillKind.SECONDARY, icon = BrambleIconName.PLUS) {
            val text = participant.trim()
            val parsed = walletContactCardParse(text, store.network)
            val key = when {
                parsed is ContactCardParse.Valid -> parsed.card.publicKeyX
                text.startsWith("0x") -> text.lowercase()
                else -> null
            }
            error = when {
                parsed is ContactCardParse.OtherNetwork -> "That wallet card belongs to a different network."
                key == null -> "Enter a valid non-zero Starknet public key."
                key in keys -> "Each signer public key can only be added once."
                else -> null
            }
            if (error == null && key != null) {
                keys = keys + key
                participant = ""
                if (parsed is ContactCardParse.Valid && parsed.card.nostrPublicKey != null) scope.launch {
                    runCatching { coordination.saveContact("Signer ${shortAddress(key)}", parsed.card.address, key, parsed.card.nostrPublicKey) }
                }
            }
        }
        BrambleField("Signatures required", "1", threshold, { threshold = it }, kind = SecretKind.AMOUNT,
            hint = "How many signers must approve each transaction?")
        PillButton("Review deployment") {
            scope.launch {
                runCatching {
                    // The deployment signer is the active account's record, never an index.
                    coordination.saveSetup(name, keys, threshold.trim().toUInt(), "0x0", account.id)
                }.onSuccess { saved = it; error = null }.onFailure { error = describe(it) }
            }
        }
        StatusLine(error, StatusTone.DANGER)
        saved?.let {
            RowTitle("Fund this multisig")
            Caption("Send STRK to this saved address to pay for deployment. You can close this screen and resume safely.")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(shortAddress(it.address), color = LocalSkin.current.text, style = textStyle(BrambleTypeScale.body, mono = true), modifier = Modifier.weight(1f))
                CopyButton(store, it.address, "Copy multisig funding address")
            }
            Caption("Deployment from mobile arrives with sending. Deploy this saved setup from Bramble for browser, or come back after the update.")
        }
    }
}

/** Settings → Network → "Multisig coordination relay". */
@Composable
fun CoordinationRelaySettings(store: WalletStore) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var relay by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { coordination.refresh() }
    Disclosure("Multisig coordination relay", open = open, onToggle = { open = !open },
        detail = if (coordination.relayPolicy?.isCustom == true) "Custom" else "Reviewed defaults") {
        BrambleField("Custom Nostr relay", "wss://relay.example", relay, { relay = it }, kind = SecretKind.ADDRESS,
            hint = "Used across networks for encrypted intent handoffs. Every co-signer must select the same relay. Leave empty for the reviewed defaults.")
        PillButton("Save coordination relay", kind = PillKind.SECONDARY, icon = BrambleIconName.CHECK) {
            scope.launch {
                runCatching { coordination.setRelay(relay) }
                    .onSuccess { store.showNotice(it); error = null }
                    .onFailure {
                        error = when {
                            it is CoreException.InvalidInput && it.reason.contains("wss") -> "Mobile connects to secure relays only (wss://)."
                            it is CoreException.InvalidInput -> "Invalid Nostr relay endpoint"
                            else -> "Coordination relay update failed"
                        }
                    }
            }
        }
        StatusLine(error, StatusTone.DANGER)
    }
}
