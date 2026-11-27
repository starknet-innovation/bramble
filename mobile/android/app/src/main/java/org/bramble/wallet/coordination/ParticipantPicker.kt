package org.bramble.wallet.coordination

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.launch
import org.bramble.core.ArgentMultisigConfig
import org.bramble.core.ContactCardParse
import org.bramble.core.argentMultisigNormalize
import org.bramble.core.walletContactCardParse
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.AccountAvatar
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.SegmentedControl
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.shortAddress

/** The longest participant name a wallet card may be saved under, in characters. */
private const val MAX_NAME_LENGTH = 64

private const val PARTIAL_CARD =
    "Ask the participant to share a full wallet card with signer and coordination keys."

private const val WALLET_CARD_HINT =
    "Adds their Starknet address, signer key, and secure coordination key to Address book."

/** How a participant not already known is entered. */
private enum class Method { PUBLIC_KEY, WALLET_CARD }

/**
 * `multisigParticipantScreen` (`journeys/multisig/multisig-participant.ts`), port of the iOS
 * `ParticipantPickerView`: [known] participants from this wallet and the address book, a shared
 * public key, or a full wallet card, which is also saved as a contact so its coordination key is
 * trusted. "Address" (look a key up on chain) needs signer discovery from events, which is
 * deferred, so it is not offered. [select] returns an error message when the participant cannot
 * be added; [close] returns to the signer setup.
 */
@Composable
internal fun ParticipantPicker(
    store: WalletStore,
    known: List<MultisigParticipant>,
    select: (MultisigParticipant) -> String?,
    close: () -> Unit,
) {
    var method by remember { mutableStateOf(Method.PUBLIC_KEY) }
    var result by remember { mutableStateOf<String?>(null) }
    var knownOpen by remember { mutableStateOf(false) }
    // A refusal stays on the picker with its reason; an accepted participant closes it.
    val finish = { participant: MultisigParticipant ->
        result = select(participant)
        if (result == null) close()
    }
    FlowHeader("Add participant", "Use an account address, public key, or full wallet card.", back = close)
    if (known.isNotEmpty()) {
        Disclosure(
            "Choose known participant",
            open = knownOpen,
            onToggle = { knownOpen = !knownOpen },
            detail = "${known.size} from this wallet and Address book",
        ) { known.forEach { KnownRow(it) { finish(it) } } }
    }
    RowTitle(if (known.isEmpty()) "Participant details" else "Add someone else")
    SegmentedControl(listOf("Public key" to Method.PUBLIC_KEY, "Wallet card" to Method.WALLET_CARD), method) {
        method = it
        result = null
    }
    when (method) {
        Method.PUBLIC_KEY -> PublicKeyEntry(finish) { result = it }
        Method.WALLET_CARD -> WalletCardEntry(store, select, close) { result = it }
    }
    StatusLine(result, StatusTone.DANGER)
}

/** A shared public key, canonicalised by the core before it is offered to [finish]. */
@Composable
private fun PublicKeyEntry(
    finish: (MultisigParticipant) -> Unit,
    refuse: (String) -> Unit,
) {
    var publicKey by remember { mutableStateOf("") }
    BrambleField(
        "Participant public key",
        "0x…",
        publicKey,
        { publicKey = it },
        kind = SecretKind.ADDRESS,
        hint = "Use a key shared by the participant.",
    )
    PillButton("Add public key") {
        val canonical = canonicalKey(publicKey)
        if (canonical == null) {
            refuse("Enter a valid non-zero Starknet public key.")
        } else {
            finish(MultisigParticipant(canonical, "Signer ${shortAddress(canonical)}", "Shared public key"))
        }
    }
}

/**
 * A named full wallet card: [select]ed as a participant, then saved as a contact so its
 * coordination key is trusted, and only then [close]d. Any refusal goes to [refuse].
 */
@Composable
private fun WalletCardEntry(
    store: WalletStore,
    select: (MultisigParticipant) -> String?,
    close: () -> Unit,
    refuse: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var card by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    BrambleField("Participant name", "e.g. Adrien", name, { name = it }, kind = SecretKind.ADDRESS)
    BrambleField(
        "Shared wallet card",
        "mcw:contact:1:…",
        card,
        { card = it },
        kind = SecretKind.ADDRESS,
        hint = WALLET_CARD_HINT,
    )
    PillButton("Add participant", busy = busy) {
        val label = name.trim()
        val parsed = cardParticipant(store, card, label)
        val refusal = parsed.exceptionOrNull()?.message ?: parsed.getOrNull()?.let { select(it.first) }
        if (refusal != null) {
            refuse(refusal)
        } else {
            val (participant, nostr) = parsed.getOrThrow()
            busy = true
            scope.launch {
                runCatching {
                    store.coordination.saveContact(label, participant.address.orEmpty(), participant.publicKeyX, nostr)
                }.onSuccess { close() }
                    .onFailure { refuse(describe(it)) }
                busy = false
            }
        }
    }
}

/** The core's canonical form of a typed public key, or null when it is not a valid non-zero key. */
private fun canonicalKey(text: String): String? =
    runCatching {
        argentMultisigNormalize(ArgentMultisigConfig(1u, listOf(text.trim().lowercase()))).signerPublicKeys.first()
    }.getOrNull()

/**
 * The participant a pasted wallet card names under [label], with the card's coordination key, or
 * a failure carrying the copy to show.
 */
private fun cardParticipant(
    store: WalletStore,
    card: String,
    label: String,
): Result<Pair<MultisigParticipant, String>> {
    val parsed = walletContactCardParse(card.trim(), store.network)
    val contact = (parsed as? ContactCardParse.Valid)?.card
    val key = contact?.publicKeyX
    val nostr = contact?.nostrPublicKey
    val participant = if (contact != null && key != null && nostr != null) contact.address to (key to nostr) else null
    val refusal =
        when {
            parsed is ContactCardParse.OtherNetwork -> "That wallet card belongs to a different network."
            contact == null -> "Paste a valid Bramble card."
            participant == null -> PARTIAL_CARD
            label.length !in 1..MAX_NAME_LENGTH -> "Enter a participant name between 1 and 64 characters."
            else -> null
        }
    return if (participant == null || refusal != null) {
        Result.failure(IllegalArgumentException(refusal))
    } else {
        val (address, keys) = participant
        Result.success(MultisigParticipant(keys.first, label, "Wallet card", address) to keys.second)
    }
}

/** A known participant: avatar, name, address, and where the key came from; tapping adds it. */
@Composable
private fun KnownRow(
    option: MultisigParticipant,
    onClick: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) { contentDescription = option.label }
            .fillPress(Color.Transparent, skin.softPress, RectangleShape, pressedScale = 1f, onClick = onClick)
            .heightIn(min = BrambleSize.row),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AccountAvatar(option.address ?: option.publicKeyX)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(option.label, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
            option.address?.let {
                Text(shortAddress(it), color = skin.muted, style = textStyle(BrambleTypeScale.body, mono = true))
            }
            Text(
                "${option.source} · Key ${shortAddress(option.publicKeyX)}",
                color = skin.muted,
                style = textStyle(BrambleTypeScale.caption),
            )
        }
        BrambleIcon(BrambleIconName.PLUS, skin.muted)
    }
}
