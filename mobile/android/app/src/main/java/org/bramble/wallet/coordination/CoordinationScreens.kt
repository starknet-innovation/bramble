package org.bramble.wallet.coordination

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import org.bramble.core.ContactCardParse
import org.bramble.core.CoreException
import org.bramble.core.MultisigRecord
import org.bramble.core.WalletContactCard
import org.bramble.core.shortKey
import org.bramble.core.walletContactCardEncode
import org.bramble.core.walletContactCardParse
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.*
import org.bramble.wallet.ui.BrambleField
import org.bramble.wallet.ui.Card
import org.bramble.wallet.ui.ErrorText
import org.bramble.wallet.ui.PrimaryButton
import org.bramble.wallet.ui.SecondaryButton

// Compose counterparts of the iOS coordination screens, with the extension's copy. Uncompiled:
// there is no Android SDK on the machine this was written on (mobile/docs/nostr-multisig.md §10).

/** Public values only, so no `EXTRA_IS_SENSITIVE` flag. */
private fun copy(context: Context, value: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    clipboard.setPrimaryClip(ClipData.newPlainText("Bramble", value))
}

@Composable
private fun Caption(text: String) =
    Text(text, color = LocalSkin.current.muted, style = textStyle(BrambleTypeScale.caption))

@Composable
private fun Title(text: String) =
    Text(text, color = LocalSkin.current.text, style = textStyle(BrambleTypeScale.title, BrambleWeight.bold))

@Composable
private fun Page(title: String, subtitle: String?, back: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        SecondaryButton("Back", onClick = back)
        Text(title, color = LocalSkin.current.text, style = textStyle(BrambleTypeScale.headline, BrambleWeight.bold, BrambleTracking.display))
        if (subtitle != null) Caption(subtitle)
        content()
    }
}

/** Receive: the "Address / Bramble contact card" choice, Copy wallet card, and Wallet identity. */
@Composable
fun ReceiveIdentity(store: WalletStore) {
    val coordination = store.coordination
    val account = store.account ?: return
    val context = LocalContext.current
    var showCard by remember { mutableStateOf(false) }
    LaunchedEffect(account.publicKey) { coordination.loadNostrKey() }
    val card = coordination.nostrKey?.let {
        runCatching { walletContactCardEncode(WalletContactCard(store.network, account.address, account.publicKey, it)) }.getOrNull()
    }
    Card {
        if (!coordination.nostrUnavailable) {
            Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                SecondaryButton("Address") { showCard = false }
                SecondaryButton("Bramble contact card") { if (card != null) showCard = true }
            }
            Caption("The contact card is public: this address, the signer public key, and the coordination public key. It holds nothing secret.")
            if (showCard && card != null) Text(card, color = LocalSkin.current.text, style = textStyle(BrambleTypeScale.mono, mono = true))
            SecondaryButton(if (card == null) "Preparing card…" else "Copy wallet card") { card?.let { copy(context, it) } }
        }
        Title("Wallet identity")
        Caption("Signer and coordination keys")
        Caption("Signer public key ${shortKey(account.publicKey)}")
        SecondaryButton("Copy signer public key") { copy(context, account.publicKey) }
        when {
            coordination.nostrUnavailable -> Caption("Coordination is unavailable. Share the account address instead.")
            coordination.nostrKey == null -> Caption("Preparing secure coordination…")
            else -> {
                Caption("Coordination public key ${shortKey(coordination.nostrKey!!)}")
                SecondaryButton("Copy coordination public key") { copy(context, coordination.nostrKey!!) }
            }
        }
    }
}

@Composable
fun AddressBookScreen(store: WalletStore, back: () -> Unit) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    var cardText by remember { mutableStateOf("") }
    var label by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var nostr by remember { mutableStateOf("") }
    var signer by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { coordination.refresh() }
    Page("Address book", "${coordination.contacts.size} saved", back) {
        BrambleField("Wallet card (optional)", cardText, { value ->
            cardText = value
            if (value.isBlank()) return@BrambleField
            result = when (val parsed = walletContactCardParse(value.trim(), store.network)) {
                is ContactCardParse.Valid -> {
                    address = parsed.card.address
                    signer = parsed.card.publicKeyX.orEmpty()
                    nostr = parsed.card.nostrPublicKey.orEmpty()
                    "Wallet card verified. Add a label, then save."
                }
                is ContactCardParse.OtherNetwork -> "This wallet card belongs to a different network."
                else -> "That wallet card is not recognized."
            }
        }, minLines = 3)
        BrambleField("Label", label, { label = it })
        BrambleField("Address", address, { address = it })
        BrambleField("Coordination public key (optional)", nostr, { nostr = it })
        BrambleField("Signer public key (optional)", signer, { signer = it })
        Caption("Saving an existing address updates its label.")
        PrimaryButton("Save address") {
            scope.launch {
                result = runCatching {
                    coordination.saveContact(label, address.trim(), signer.trim().ifEmpty { null }, nostr.trim().ifEmpty { null })
                    "Address saved"
                }.getOrElse { describe(it) }
            }
        }
        result?.let { Caption(it) }
        Title("Saved addresses")
        if (coordination.contacts.isEmpty()) Caption("No saved addresses yet. Save one to reuse it when sending.")
        coordination.contacts.forEach { contact ->
            Card {
                Title(contact.label)
                Caption(shortKey(contact.address))
                contact.publicKeyX?.let { Caption("Signer key ${shortKey(it)}") }
                if (contact.nostrPublicKey != null) Caption("Secure coordination ready")
                SecondaryButton("Remove ${contact.label}", destructive = true) { scope.launch { runCatching { coordination.removeContact(contact.id) } } }
            }
        }
    }
}

private fun configLabel(record: MultisigRecord): String =
    record.threshold?.let { "$it of ${record.signerCount} signers" } ?: "Authority unavailable"

/** Shared accounts: list, add by address, a created setup, and co-signer updates. */
@Composable
fun SharedAccountsScreen(store: WalletStore, back: () -> Unit) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var addResult by remember { mutableStateOf<String?>(null) }
    var syncResult by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    LaunchedEffect(Unit) { coordination.refresh() }
    val records = coordination.multisigs
    Page("Shared accounts", "${records.size} account${if (records.size == 1) "" else "s"}", back) {
        Card {
            Title("Add shared account")
            BrambleField("Multisig address", address, { address = it })
            Caption("If deployed, signer authority syncs from Starknet. If not, the address is saved and deployment setup is verified before use.")
            PrimaryButton("Add shared account") {
                scope.launch { addResult = runCatching { coordination.addShared(address) }.getOrElse { it.message ?: describe(it) } }
            }
            addResult?.let { Caption(it) }
        }
        CreateMultisigCard(store)
        if (records.isEmpty()) Caption("No shared accounts are saved on this network yet.")
        records.forEach { record ->
            Card {
                Title(record.name ?: shortKey(record.address))
                Caption(configLabel(record))
                Title("Co-signer updates")
                Caption("Check securely for intents and signatures shared by known contacts.")
                SecondaryButton("Check for updates") {
                    scope.launch {
                        val message = runCatching { coordination.sync(record.id) }.fold(
                            { if (it.held == 0u) "No new co-signer updates" else "${it.held} co-signer update${if (it.held == 1u) "" else "s"} received. Open them after the next Bramble update." },
                            { if (it is CoreException.Coordination) "Secure co-signer updates are unavailable. Try again shortly" else "Secure co-signer updates could not be verified. Try again shortly" },
                        )
                        syncResult = syncResult + (record.id to message)
                    }
                }
                syncResult[record.id]?.let { Caption(it) }
                Caption("Removing stops local tracking only. It never changes the on-chain account.")
                SecondaryButton("Stop watching", destructive = true) { scope.launch { runCatching { coordination.removeShared(record.id) } } }
            }
        }
    }
}

/** Create: the current account plus pasted public keys or full wallet cards, then Approval. */
@Composable
private fun CreateMultisigCard(store: WalletStore) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    val account = store.account ?: return
    var keys by remember { mutableStateOf(listOf(account.publicKey)) }
    var participant by remember { mutableStateOf("") }
    var threshold by remember { mutableStateOf("1") }
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf<MultisigRecord?>(null) }
    Card {
        Title("Create a multisig")
        BrambleField("Shared account name (optional)", name, { name = it.take(48) })
        Caption("Signer set · ${keys.size} signer${if (keys.size == 1) "" else "s"}")
        keys.forEach { Caption("Key ${shortKey(it)}") }
        BrambleField("Participant public key or wallet card", participant, { participant = it }, minLines = 2)
        SecondaryButton("Add participant") {
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
                    runCatching { coordination.saveContact("Signer ${shortKey(key)}", parsed.card.address, key, parsed.card.nostrPublicKey) }
                }
            }
        }
        BrambleField("Signatures required", threshold, { threshold = it })
        Caption("How many signers must approve each transaction?")
        PrimaryButton("Review deployment") {
            scope.launch {
                runCatching {
                    val count = threshold.trim().toUInt()
                    coordination.saveSetup(name, keys, count, "0x0", account.index)
                }.onSuccess { saved = it; error = null }.onFailure { error = describe(it) }
            }
        }
        ErrorText(error)
        saved?.let {
            Title("Fund this multisig")
            Caption("Send STRK to this saved address to pay for deployment. You can close this screen and resume safely.")
            Text(it.address, color = LocalSkin.current.text, style = textStyle(BrambleTypeScale.mono, mono = true))
            Caption("Deployment from mobile arrives with sending. Deploy this saved setup from Bramble for browser, or come back after the update.")
        }
    }
}

/** Settings → Network → "Multisig coordination relay". */
@Composable
fun CoordinationRelaySettings(store: WalletStore) {
    val coordination = store.coordination
    val scope = rememberCoroutineScope()
    var relay by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { coordination.refresh() }
    Card {
        Title("Multisig coordination relay")
        Caption(if (coordination.relayPolicy?.isCustom == true) "Custom" else "Reviewed defaults")
        BrambleField("Custom Nostr relay", relay, { relay = it })
        Caption("Used across networks for encrypted intent handoffs. Every co-signer must select the same relay. Leave empty for the reviewed defaults.")
        SecondaryButton("Save coordination relay") {
            scope.launch {
                result = runCatching { coordination.setRelay(relay) }.getOrElse {
                    when {
                        it is CoreException.InvalidInput && it.reason.contains("wss") -> "Mobile connects to secure relays only (wss://)."
                        it is CoreException.InvalidInput -> "Invalid Nostr relay endpoint"
                        else -> "Coordination relay update failed"
                    }
                }
            }
        }
        result?.let { Caption(it) }
    }
}
