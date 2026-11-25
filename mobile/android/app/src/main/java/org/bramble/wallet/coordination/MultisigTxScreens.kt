package org.bramble.wallet.coordination

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import org.bramble.core.ConfigChange
import org.bramble.core.MultisigIntent
import org.bramble.core.MultisigProposalRequest
import org.bramble.core.MultisigRecord
import org.bramble.core.MultisigTxFailure
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.ui.shortAddress

// Multisig transaction screens (M18), port of the iOS `MultisigProposeView.swift` and
// `MultisigIntentView.swift`: propose a transfer or a signer change, import a package, and one
// intent's card. Every review and refusal is the core's, shown as it comes.

/**
 * What a proposal form hands its controls: whether a proposal is running, the request the core
 * refused as `RESEND_UNCONFIRMED` (pressing its control again sends it with the person's
 * confirmation), and how to start one.
 */
private class ProposalControl(
    val busy: Boolean,
    private val armed: MultisigProposalRequest?,
    val propose: (MultisigProposalRequest) -> Unit,
) {
    /** The control's label: "Send anyway" once its request is armed. */
    fun label(
        idle: String,
        request: MultisigProposalRequest?,
    ): String = if (request != null && request == armed) MultisigTxText.SEND_ANYWAY else idle
}

/** A proposal screen's title and its success toast (`multisig.propose.ready` or `signers.changeReady`). */
private data class ProposalCopy(
    val title: String,
    val ready: String,
)

/** The frame every proposal shares: the form, then the stored intent's card in its place. */
@Composable
private fun ProposalScreen(
    store: WalletStore,
    copy: ProposalCopy,
    multisigId: String,
    back: () -> Unit,
    form: @Composable ColumnScope.(MultisigRecord, ProposalControl) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val record = store.coordination.multisigs.firstOrNull { it.id == multisigId }
    var busy by remember { mutableStateOf(false) }
    var armed by remember { mutableStateOf<MultisigProposalRequest?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var intent by remember { mutableStateOf<MultisigIntent?>(null) }
    Page(store, copy.title, record?.let(::multisigDisplayName), back) {
        val proposed = intent
        if (proposed != null) {
            IntentCard(store, proposed) { intent = it }
        } else if (record != null) {
            val control =
                ProposalControl(busy, armed) { request ->
                    scope.launch {
                        busy = true
                        runCatching {
                            store.coordination.propose(request, record, store.portfolio.preferences, armed == request)
                        }.onSuccess {
                            intent = it
                            store.showNotice(copy.ready)
                        }.onFailure {
                            val failure = (it as? MultisigTxException)?.failure
                            armed = if (failure == MultisigTxFailure.RESEND_UNCONFIRMED) request else null
                            error = (it as? MultisigTxException)?.message ?: describe(it)
                        }
                        busy = false
                    }
                }
            form(record, control)
            StatusLine(error, StatusTone.DANGER)
        }
    }
}

/** `multisig-propose`: an ERC-20 transfer from the multisig, built and reviewed by the core. */
@Composable
internal fun MultisigProposeScreen(
    store: WalletStore,
    multisigId: String,
    back: () -> Unit,
) {
    var tokenId by remember { mutableStateOf<String?>(null) }
    var recipient by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    val copy = ProposalCopy(MultisigTxText.NEW_TRANSACTION, MultisigTxText.READY)
    ProposalScreen(store, copy, multisigId, back) { _, control ->
        val tokens = store.portfolio.tracked.map { it.token }
        val selected = tokenId ?: tokens.firstOrNull()?.id
        val request = selected?.let { MultisigProposalRequest.Transfer(it, recipient, amount) }
        if (tokens.isEmpty()) {
            Caption(MultisigTxText.NO_TOKENS)
        } else {
            Eyebrow(MultisigTxText.TOKEN)
            MenuGroup {
                tokens.forEachIndexed { index, token ->
                    if (index > 0) MenuDivider()
                    MenuRow(null, token.symbol, selected = token.id == selected) { tokenId = token.id }
                }
            }
        }
        BrambleField(MultisigTxText.TO, "0x…", recipient, { recipient = it }, kind = SecretKind.ADDRESS)
        BrambleField(MultisigTxText.AMOUNT_TO_SEND, "0", amount, { amount = it }, kind = SecretKind.AMOUNT)
        PillButton(
            control.label(MultisigTxText.REVIEW_TRANSACTION, request),
            icon = BrambleIconName.SEND,
            busy = control.busy,
            enabled = request != null && recipient.isNotBlank() && amount.isNotBlank(),
        ) { request?.let(control.propose) }
    }
}

/**
 * `multisig-signers`: the current signers, then adding one, removing one, or changing the
 * approvals required, each proposed as the core's self-call and signed like any transaction.
 */
@Composable
internal fun MultisigSignersScreen(
    store: WalletStore,
    multisigId: String,
    back: () -> Unit,
) {
    var newKey by remember { mutableStateOf("") }
    var addThreshold by remember { mutableStateOf("") }
    var removing by remember { mutableStateOf<String?>(null) }
    var removeThreshold by remember { mutableStateOf("") }
    var threshold by remember { mutableStateOf("") }
    val copy = ProposalCopy(MultisigTxText.SIGNERS, MultisigTxText.CHANGE_READY)
    ProposalScreen(store, copy, multisigId, back) { record, control ->
        val keys = record.signerPublicKeys
        val add = addThreshold.toUIntOrNull()?.let { change(ConfigChange.AddSigners(listOf(newKey), it)) }
        val remove =
            removing?.let { key ->
                removeThreshold.toUIntOrNull()?.let { change(ConfigChange.RemoveSigners(listOf(key), it)) }
            }
        val retarget = threshold.toUIntOrNull()?.let { change(ConfigChange.ChangeThreshold(it)) }
        record.threshold?.let { Caption(MultisigTxText.currently(it, keys.size)) }
        Eyebrow(MultisigTxText.CURRENT)
        MenuGroup {
            keys.forEachIndexed { index, key ->
                if (index > 0) MenuDivider()
                MenuRow(BrambleIconName.KEY_ROUND, shortAddress(key), selected = removing == key) {
                    removing = if (removing == key) null else key
                }
            }
        }
        Eyebrow(MultisigTxText.ADD_PARTICIPANT)
        BrambleField(MultisigTxText.ENTER_KEY, "0x…", newKey, { newKey = it }, kind = SecretKind.ADDRESS)
        BrambleField(
            MultisigTxText.APPROVALS_AFTER_ADDING,
            "",
            addThreshold,
            { addThreshold = it },
            kind = SecretKind.AMOUNT,
        )
        ChangeButton(MultisigTxText.REVIEW_ADDITION, add?.takeIf { newKey.isNotBlank() }, control)
        if (removing != null) {
            Eyebrow(MultisigTxText.REVIEW_REMOVAL)
            BrambleField(
                MultisigTxText.APPROVALS_AFTER_REMOVAL,
                "",
                removeThreshold,
                { removeThreshold = it },
                kind = SecretKind.AMOUNT,
            )
            ChangeButton(MultisigTxText.REVIEW_REMOVAL, remove, control)
        }
        Eyebrow(MultisigTxText.CHANGE_THRESHOLD)
        BrambleField(MultisigTxText.NEW_THRESHOLD, "", threshold, { threshold = it }, kind = SecretKind.AMOUNT)
        ChangeButton(MultisigTxText.REVIEW_THRESHOLD, retarget, control)
    }
}

private fun change(change: ConfigChange) = MultisigProposalRequest.ChangeSigners(change)

@Composable
private fun ChangeButton(
    title: String,
    request: MultisigProposalRequest?,
    control: ProposalControl,
) = PillButton(
    control.label(title, request),
    kind = PillKind.SECONDARY,
    busy = control.busy,
    enabled = request != null,
) {
    request?.let(control.propose)
}

/** `multisig-track`: verify and import a co-signer's full package for this multisig. */
@Composable
internal fun MultisigImportScreen(
    store: WalletStore,
    multisigId: String,
    back: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val record = store.coordination.multisigs.firstOrNull { it.id == multisigId }
    var pkg by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var intent by remember { mutableStateOf<MultisigIntent?>(null) }
    Page(store, MultisigTxText.IMPORT_TRANSACTION, record?.let(::multisigDisplayName), back) {
        val imported = intent
        if (imported != null) {
            IntentCard(store, imported) { intent = it }
        } else if (record != null) {
            BrambleField(
                MultisigTxText.INTENT_PACKAGE,
                "",
                pkg,
                { pkg = it },
                kind = SecretKind.ADDRESS,
                hint = MultisigTxText.IMPORT_NOTE,
            )
            PillButton(MultisigTxText.VERIFY_IMPORT, busy = busy, enabled = pkg.isNotBlank()) {
                scope.launch {
                    busy = true
                    runCatching { store.coordination.importIntent(pkg, record, store.portfolio.preferences) }
                        .onSuccess {
                            intent = it
                            error = null
                            store.showNotice(MultisigTxText.VERIFIED)
                        }.onFailure { error = describe(it) }
                    busy = false
                }
            }
            StatusLine(error, StatusTone.DANGER)
        }
    }
}

/** One stored intent, loaded by id (`intentCard`). */
@Composable
internal fun MultisigIntentScreen(
    store: WalletStore,
    multisigId: String,
    intentId: String,
    back: () -> Unit,
) {
    val record = store.coordination.multisigs.firstOrNull { it.id == multisigId }
    var intent by remember { mutableStateOf<MultisigIntent?>(null) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(intentId) {
        intent = store.coordination.intents(multisigId).firstOrNull { it.id == intentId }
        loaded = true
    }
    Page(store, MultisigTxText.REVIEWED, record?.let(::multisigDisplayName), back) {
        val shown = intent
        if (shown != null) {
            IntentCard(store, shown) { intent = it }
        } else if (loaded) {
            Caption(MultisigTxText.GONE)
        }
    }
}
