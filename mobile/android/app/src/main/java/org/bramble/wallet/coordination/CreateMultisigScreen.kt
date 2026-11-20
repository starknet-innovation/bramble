package org.bramble.wallet.coordination

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
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
import org.bramble.core.AccountRecord
import org.bramble.core.MultisigRecord
import org.bramble.core.multisigLimits
import org.bramble.wallet.WalletStore
import org.bramble.wallet.describe
import org.bramble.wallet.design.AccountAvatar
import org.bramble.wallet.design.BrambleField
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Disclosure
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.IconButton
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.MenuRow
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress

private val STEPS = listOf("Participants", "Approval", "Fund", "Deploy")
private const val PARTICIPANTS = 0
private const val APPROVAL = 1
private const val FUND = 2
private const val DEPLOY = 3

private const val UNDECLARED_CLASS =
    "The pinned Ready Multisig 0.2 class is not declared on this network. " +
        "Predeclare the audited class before deployment."

/** The create flow's editable state, held together so the stages read one place. */
private class MultisigDraft {
    var stage by mutableStateOf(PARTICIPANTS)
    var name by mutableStateOf("")
    var participants by mutableStateOf(listOf<MultisigParticipant>())
    var threshold by mutableStateOf("1")
    var deployer by mutableStateOf<String?>(null)
    var salt by mutableStateOf("0x0")
    var picking by mutableStateOf(false)
    var saved by mutableStateOf<MultisigRecord?>(null)

    /** Whether the pinned class is declared: null while checking; [Declared.UNVERIFIED] on a failed read. */
    var declared by mutableStateOf<Declared?>(null)
    var result by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)

    /** This wallet's account records in the signer set. */
    fun localSigners(records: List<AccountRecord>) =
        records.filter { account -> participants.any { it.publicKeyX == account.publicKey } }

    /** The record id that signs and pays for deployment (never an account index). */
    fun effectiveDeployer(records: List<AccountRecord>): String? {
        val local = localSigners(records)
        return deployer?.takeIf { id -> local.any { it.id == id } } ?: local.firstOrNull()?.id
    }
}

/** The pinned class's availability on the active network. */
private enum class Declared { YES, NO, UNVERIFIED }

/** This wallet's accounts and the address book's keyed contacts, as pickable participants. */
private fun knownParticipants(store: WalletStore): List<MultisigParticipant> =
    store.records.map { MultisigParticipant(it.publicKey, it.displayName, "This wallet", it.address) } +
        store.coordination.contacts.mapNotNull { contact ->
            contact.publicKeyX?.let { MultisigParticipant(it, contact.label, "Saved contact", contact.address) }
        }

/**
 * `multisig-deploy` (`journeys/multisig/multisig-deploy-view.ts`), port of the iOS
 * `CreateMultisigView`: Participants, Approval, Fund, Deploy. Leaving Approval saves the
 * undeployed setup (its commitment re-derives to the address), so the flow can be closed and
 * resumed by [resumeId]. Deployment itself is not on mobile yet (docs/nostr-multisig.md §2.5).
 */
@Composable
internal fun CreateMultisigScreen(
    store: WalletStore,
    resumeId: String?,
    back: () -> Unit,
) {
    val draft = remember { MultisigDraft() }
    LaunchedEffect(Unit) { load(store, draft, resumeId) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.md),
    ) {
        if (draft.picking) {
            ParticipantPicker(store, knownParticipants(store), select = { add(draft, it) }) { draft.picking = false }
        } else {
            FlowHeader(
                if (resumeId == null) "Create multisig" else "Complete multisig setup",
                "Multiple signers approve together",
                store.networkLabel,
                back,
            )
            if (draft.declared == Declared.NO) Caption(UNDECLARED_CLASS) else Stages(store, draft, resumeId != null)
        }
    }
}

/** The progress, the class check's status, and the current stage. */
@Composable
private fun Stages(
    store: WalletStore,
    draft: MultisigDraft,
    resumed: Boolean,
) {
    StepProgress(STEPS, draft.stage)
    if (draft.declared == null) StatusLine("Checking the pinned class on this network…")
    if (draft.declared == Declared.UNVERIFIED) {
        StatusLine("Class availability could not be verified. Deployment remains disabled.", StatusTone.DANGER)
    }
    when (draft.stage) {
        PARTICIPANTS -> ParticipantsStage(store, draft, resumed)
        APPROVAL -> ApprovalStage(store, draft)
        FUND -> MultisigFundStage(store, draft.saved) { draft.stage = DEPLOY }
        else -> MultisigDeployStage(draft.saved)
    }
}

/** Adds [participant] unless its key is already a signer or the set is full; returns the refusal. */
private fun add(
    draft: MultisigDraft,
    participant: MultisigParticipant,
): String? =
    when {
        draft.participants.any { it.publicKeyX == participant.publicKeyX } -> {
            "Each signer public key can only be added once."
        }

        draft.participants.size >= multisigLimits().signers.toInt() -> {
            "Argent multisig threshold or signer count is invalid."
        }

        else -> {
            draft.participants = draft.participants + participant
            null
        }
    }

/** Restores a saved setup (or starts from the active account), then reads the pinned class. */
private suspend fun load(
    store: WalletStore,
    draft: MultisigDraft,
    resumeId: String?,
) {
    store.coordination.refresh()
    val record = resumeId?.let { id -> store.coordination.multisigs.firstOrNull { it.id == id } }
    val deployment = record?.deployment
    if (record != null && deployment != null) {
        val known = knownParticipants(store)
        draft.participants =
            deployment.config.signerPublicKeys.map { key ->
                known.firstOrNull { it.publicKeyX == key }
                    ?: MultisigParticipant(key, "Signer ${shortAddress(key)}", "Deployment setup")
            }
        draft.name = record.name.orEmpty()
        draft.threshold = deployment.config.threshold.toString()
        draft.salt = deployment.salt
        draft.saved = record
        draft.stage = APPROVAL
    } else {
        store.activeRecord?.let {
            draft.participants = listOf(MultisigParticipant(it.publicKey, it.displayName, "This wallet", it.address))
        }
    }
    // A failed chain read leaves availability unverified.
    draft.declared =
        when (store.coordination.classDeclared()) {
            true -> Declared.YES
            false -> Declared.NO
            null -> Declared.UNVERIFIED
        }
}

@Composable
private fun ParticipantsStage(
    store: WalletStore,
    draft: MultisigDraft,
    resumed: Boolean,
) {
    val skin = LocalSkin.current
    val nameLimit = multisigLimits().nameLength.toInt()
    if (resumed) StatusLine("Saved setup restored. Confirm the signers, then continue.")
    BrambleField(
        "Shared account name (optional)",
        "",
        draft.name,
        { draft.name = it.take(nameLimit) },
        kind = SecretKind.ADDRESS,
    )
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "Signer set",
            color = skin.text,
            style = textStyle(BrambleTypeScale.body, BrambleWeight.bold),
            modifier = Modifier.weight(1f),
        )
        val count = draft.participants.size
        Text(
            "$count signer${if (count == 1) "" else "s"}",
            color = skin.muted,
            style = textStyle(BrambleTypeScale.caption),
        )
    }
    MenuGroup {
        draft.participants.forEachIndexed { index, participant ->
            if (index > 0) MenuDivider()
            SignerRow(store, participant, removable = draft.participants.size > 1) {
                draft.participants = draft.participants.filterNot { it.publicKeyX == participant.publicKeyX }
            }
        }
    }
    PillButton("Add participant", kind = PillKind.SECONDARY, icon = BrambleIconName.PLUS) { draft.picking = true }
    val noLocal = draft.localSigners(store.records).isEmpty()
    PillButton("Continue to approval", enabled = !noLocal) { draft.stage = APPROVAL }
    if (noLocal) StatusLine("Add an account from this wallet to the signer set before continuing.")
}

@Composable
private fun SignerRow(
    store: WalletStore,
    participant: MultisigParticipant,
    removable: Boolean,
    remove: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier.padding(horizontal = BrambleSpace.md, vertical = BrambleSpace.xs),
        horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AccountAvatar(participant.address ?: participant.publicKeyX)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleLayout.rowTextGap)) {
            Text(participant.label, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
            Text(
                "${participant.source} · Key ${shortAddress(participant.publicKeyX)}",
                color = skin.muted,
                style = textStyle(BrambleTypeScale.caption),
            )
        }
        CopyButton(store, participant.publicKeyX, "Copy ${participant.label} signer public key")
        IconButton(
            BrambleIconName.X,
            "Remove ${participant.label}",
            tint = skin.muted,
            enabled = removable,
            onClick = remove,
        )
    }
}

@Composable
private fun ApprovalStage(
    store: WalletStore,
    draft: MultisigDraft,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var advancedOpen by remember { mutableStateOf(false) }
    val local = draft.localSigners(store.records)
    val deployer = draft.effectiveDeployer(store.records)
    if (local.isEmpty()) {
        StatusLine(
            "No saved participant can deploy from this wallet. Go back and add a local account.",
            StatusTone.DANGER,
        )
    }
    BrambleField(
        "Signatures required",
        "1",
        draft.threshold,
        { draft.threshold = it },
        kind = SecretKind.AMOUNT,
        hint = "How many signers must approve each transaction?",
    )
    Text("Deployment signer", color = skin.muted, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold))
    MenuGroup {
        local.forEachIndexed { index, account ->
            if (index > 0) MenuDivider()
            MenuRow(
                null,
                account.displayName,
                value = account.shortAddress,
                selected = account.id == deployer,
                chevron = false,
            ) {
                draft.deployer = account.id
            }
        }
    }
    Caption("This account signs and pays for deployment.")
    Disclosure("Advanced deployment settings", advancedOpen, { advancedOpen = !advancedOpen }, "Default salt · 0x0") {
        BrambleField("Deployment salt", "0x0", draft.salt, { draft.salt = it }, kind = SecretKind.ADDRESS)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        PillButton("Back", Modifier.weight(1f), PillKind.GHOST) { draft.stage = PARTICIPANTS }
        PillButton(
            "Review deployment",
            Modifier.weight(1f),
            busy = draft.busy,
            enabled = draft.declared == Declared.YES && deployer != null,
        ) { scope.launch { review(store, draft, deployer) } }
    }
    StatusLine(draft.result, StatusTone.DANGER)
}

/** Validates the threshold, then saves the undeployed setup and moves on to funding. */
private suspend fun review(
    store: WalletStore,
    draft: MultisigDraft,
    deployer: String?,
) {
    val count = draft.threshold.trim().toUIntOrNull()
    if (count == null || count < 1u || count > draft.participants.size.toUInt()) {
        draft.result = "Enter between 1 and ${draft.participants.size} signatures."
        return
    }
    if (deployer == null) return
    draft.busy = true
    runCatching {
        store.coordination.saveSetup(
            draft.name,
            draft.participants.map { it.publicKeyX },
            count,
            draft.salt.trim(),
            deployer,
        )
    }.onSuccess {
        draft.saved = it
        draft.result = null
        draft.stage = FUND
    }.onFailure { draft.result = describe(it) }
    draft.busy = false
}
