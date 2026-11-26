package org.bramble.wallet.coordination

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import org.bramble.core.AccountRecord
import org.bramble.core.IntentState
import org.bramble.core.MultisigIntent
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleRadius
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.AddressClipboard
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress

// One signing intent's card (M18), port of the iOS `MultisigIntentView.swift`: the core's summary
// and facts, the one action its state allows, and the exact calls.

/**
 * The intent's card: the core's summary, its signatures and maximum fee, the one action its state
 * allows, and the exact calls. A refusal may mark the intent stale, so it is reread either way.
 */
@Composable
internal fun IntentCard(
    store: WalletStore,
    intent: MultisigIntent,
    changed: (MultisigIntent) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    val run = { body: suspend () -> String ->
        // Busy before the coroutine starts, so a second tap in the same frame cannot submit twice.
        busy = true
        scope.launch {
            runCatching { body() }
                .onSuccess {
                    result = it
                    failed = false
                }.onFailure {
                    result = (it as? MultisigTxException)?.message ?: describeRefusal(it)
                    failed = true
                }
            store.coordination
                .intents(intent.multisigId)
                .firstOrNull { it.id == intent.id }
                ?.let(changed)
            busy = false
        }
    }
    IntentFacts(store, intent)
    IntentActions(store, intent, busy) { body -> run(body) }
    StatusLine(result, if (failed) StatusTone.DANGER else StatusTone.POSITIVE)
    IntentTechnical(intent)
}

/** The summary panel, and the hash once it was sent. */
@Composable
private fun IntentFacts(
    store: WalletStore,
    intent: MultisigIntent,
) {
    val skin = LocalSkin.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(skin.panel, RoundedCornerShape(BrambleRadius.lg))
            .padding(BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) {
        Text(intent.summary, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.bold))
        if (intent.state == IntentState.STALE) {
            Text(MultisigTxText.OUT_OF_DATE, color = skin.danger, style = textStyle(BrambleTypeScale.caption))
        }
        Fact(MultisigTxText.SIGNATURES, MultisigTxText.signatureCount(intent))
        intent.maxFee?.let { Fact(MultisigTxText.MAX_FEE, it.display) }
    }
    intent.broadcastTransactionHash?.let { hash ->
        Row {
            Caption(MultisigTxText.SUBMITTED_KICKER + " · " + shortAddress(hash))
            CopyButton(store, hash, MultisigTxText.COPY_HASH)
        }
    }
}

/** The note, the signer choice, the one action, and the package copy. */
@Composable
private fun IntentActions(
    store: WalletStore,
    intent: MultisigIntent,
    busy: Boolean,
    run: (suspend () -> String) -> Unit,
) {
    var signer by remember { mutableStateOf<String?>(null) }
    val available = availableSigners(intent, store.records)
    val chosen = available.firstOrNull { it.id == signer }?.id ?: available.firstOrNull()?.id
    val (action, note) = MultisigTxText.action(intent, available.isNotEmpty(), holdsSigner(intent, store.records))
    note?.let { Caption(it) }
    if (action == IntentAction.SIGN && available.size > 1) SignerChoice(available, chosen) { signer = it }
    val submit = { run { MultisigTxText.submitted(store.coordination.submit(intent)) } }
    when (action) {
        IntentAction.SIGN -> {
            PillButton(MultisigTxText.SIGN, busy = busy, enabled = chosen != null) {
                chosen?.let { id -> run { MultisigTxText.signed(store.coordination.sign(intent, id)) } }
            }
        }

        IntentAction.SUBMIT -> {
            PillButton(MultisigTxText.SUBMIT, busy = busy, onClick = submit)
        }

        IntentAction.RETRY_UNCHANGED_FEE -> {
            PillButton(MultisigTxText.TRY_UNCHANGED_FEE, kind = PillKind.SECONDARY, busy = busy, onClick = submit)
        }

        IntentAction.COPY_PACKAGE, IntentAction.NONE -> {}
    }
    if (intent.state == IntentState.COLLECTING || intent.state == IntentState.READY) {
        CopyPackage(store, intent, primary = action == IntentAction.COPY_PACKAGE)
    }
}

/** "Signer in this wallet": which of several eligible accounts signs. */
@Composable
private fun SignerChoice(
    available: List<AccountRecord>,
    chosen: String?,
    choose: (String) -> Unit,
) {
    Eyebrow(MultisigTxText.SIGNER_SELECT)
    MenuGroup {
        available.forEachIndexed { index, account ->
            if (index > 0) MenuDivider()
            MenuRow(BrambleIconName.USER, account.displayName, selected = account.id == chosen) { choose(account.id) }
        }
    }
}

/** "Copy transaction package": the public package a co-signer imports. */
@Composable
private fun CopyPackage(
    store: WalletStore,
    intent: MultisigIntent,
    primary: Boolean,
) {
    val context = LocalContext.current
    PillButton(MultisigTxText.COPY_PACKAGE, kind = if (primary) PillKind.PRIMARY else PillKind.SECONDARY) {
        if (AddressClipboard.copy(context, intent.`package`, store.appScope)) store.showNotice("Copied")
    }
}

/** "Technical details": the hash, the nonce, and each frozen call. */
@Composable
private fun IntentTechnical(intent: MultisigIntent) {
    val skin = LocalSkin.current
    var open by remember { mutableStateOf(false) }
    Disclosure(MultisigTxText.TECHNICAL, open, { open = !open }) {
        Fact(MultisigTxText.HASH, shortAddress(intent.transactionHash))
        Fact(MultisigTxText.NONCE, intent.nonce)
        intent.calls.forEachIndexed { index, call ->
            Text(
                "Call ${index + 1} · ${call.entrypoint}",
                color = skin.text,
                style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold),
            )
            Caption("Contract · ${call.contractAddress}")
            Caption("Calldata · ${call.calldata.joinToString(" ").ifEmpty { "none" }}")
        }
    }
}

/** A label and its value on one line. */
@Composable
private fun Fact(
    label: String,
    value: String,
) {
    val skin = LocalSkin.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        Text(value, color = skin.text, style = textStyle(BrambleTypeScale.caption, BrambleWeight.semibold))
    }
}
