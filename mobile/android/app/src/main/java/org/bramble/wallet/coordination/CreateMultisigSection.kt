package org.bramble.wallet.coordination

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.bramble.core.ContactCardParse
import org.bramble.core.MultisigRecord
import org.bramble.core.walletContactCardParse
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress

// The "Create a multisig" section of the shared-accounts screen: signer keys from public keys or
// wallet cards, the threshold, the saved setup, and its funding address.

/** The longest shared-account name the create form keeps; longer input is cut. */
private const val MULTISIG_NAME_MAX = 48

private const val FUND_NOTE =
    "Send STRK to this saved address to pay for deployment. You can close this screen and resume safely."

private const val DEPLOY_LATER_NOTE =
    "Deployment from mobile arrives with sending. Deploy this saved setup from Bramble for browser, " +
        "or come back after the update."

/** The signer key a participant entry adds: a valid card's key, or a typed `0x` key; else null. */
private fun participantKey(
    parsed: ContactCardParse,
    text: String,
): String? =
    when {
        parsed is ContactCardParse.Valid -> parsed.card.publicKeyX
        text.startsWith("0x") -> text.lowercase()
        else -> null
    }

/** Why a participant entry cannot be added to [keys], or null when [key] can be. */
private fun participantError(
    parsed: ContactCardParse,
    key: String?,
    keys: List<String>,
): String? =
    when {
        parsed is ContactCardParse.OtherNetwork -> "That wallet card belongs to a different network."
        key == null -> "Enter a valid non-zero Starknet public key."
        key in keys -> "Each signer public key can only be added once."
        else -> null
    }

/** Create: the active account plus pasted public keys or full wallet cards, then Approval. */
@Composable
internal fun CreateMultisigSection(store: WalletStore) {
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
    Disclosure(
        "Create a multisig",
        open = open,
        onToggle = { open = !open },
        detail = "${keys.size} signer${if (keys.size == 1) "" else "s"}",
    ) {
        SignerFields(name, { name = it.take(MULTISIG_NAME_MAX) }, keys, participant) { participant = it }
        PillButton("Add participant", kind = PillKind.SECONDARY, icon = BrambleIconName.PLUS) {
            val text = participant.trim()
            val parsed = walletContactCardParse(text, store.network)
            val key = participantKey(parsed, text)
            error = participantError(parsed, key, keys)
            if (error == null && key != null) {
                keys = keys + key
                participant = ""
                if (parsed is ContactCardParse.Valid) saveSignerContact(store, scope, parsed, key)
            }
        }
        BrambleField(
            "Signatures required",
            "1",
            threshold,
            { threshold = it },
            kind = SecretKind.AMOUNT,
            hint = "How many signers must approve each transaction?",
        )
        PillButton("Review deployment") {
            scope.launch {
                runCatching {
                    // The deployment signer is the active account's record, never an index.
                    coordination.saveSetup(name, keys, threshold.trim().toUInt(), "0x0", account.id)
                }.onSuccess {
                    saved = it
                    error = null
                }.onFailure { error = describe(it) }
            }
        }
        StatusLine(error, StatusTone.DANGER)
        saved?.let { FundMultisig(store, it) }
    }
}

/** The name field, the signer keys so far, and the participant entry field. */
@Composable
private fun SignerFields(
    name: String,
    onName: (String) -> Unit,
    keys: List<String>,
    participant: String,
    onParticipant: (String) -> Unit,
) {
    BrambleField(
        "Shared account name (optional)",
        "",
        name,
        onName,
        kind = SecretKind.ADDRESS,
    )
    keys.forEach { Caption("Key ${shortAddress(it)}") }
    BrambleField(
        "Participant public key or wallet card",
        "0x… or mcw:contact:1:…",
        participant,
        onParticipant,
        kind = SecretKind.ADDRESS,
    )
}

/**
 * A participant added from a full wallet card is also saved as a contact, so its coordination
 * identity is known; a card without one saves nothing, and a failed save is ignored.
 */
private fun saveSignerContact(
    store: WalletStore,
    scope: CoroutineScope,
    parsed: ContactCardParse.Valid,
    key: String,
) {
    if (parsed.card.nostrPublicKey == null) return
    scope.launch {
        runCatching {
            store.coordination.saveContact(
                "Signer ${shortAddress(key)}",
                parsed.card.address,
                key,
                parsed.card.nostrPublicKey,
            )
        }
    }
}

/** The saved setup's funding address and what happens next. */
@Composable
private fun FundMultisig(
    store: WalletStore,
    record: MultisigRecord,
) {
    RowTitle("Fund this multisig")
    Caption(FUND_NOTE)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            shortAddress(record.address),
            color = LocalSkin.current.text,
            style = textStyle(BrambleTypeScale.body, mono = true),
            modifier = Modifier.weight(1f),
        )
        CopyButton(store, record.address, "Copy multisig funding address")
    }
    Caption(DEPLOY_LATER_NOTE)
}
