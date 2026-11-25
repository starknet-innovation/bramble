package org.bramble.wallet.staking

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import kotlinx.coroutines.launch
import org.bramble.core.StakingView
import org.bramble.core.accountLabel
import org.bramble.core.compactAmount
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIcon
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.SecretKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.fillPress
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.makeStakingAction
import org.bramble.wallet.makeStakingModel
import org.bramble.wallet.send.panelShape

/** The core's amount formatter for a position line. */
internal fun coreAmount(value: String): String = compactAmount(value, null)

/**
 * The staking screen, twin of the iOS `StakingScreen` (`stakingFlow` in `staking-views.ts`): "Your
 * stakes", Starkscan's directory and the paste field; one validator's pools; and an action's
 * review in place of both while one is open. Every figure is the core's on-chain reading;
 * directory text is third-party, shown as plain text. Where the core refuses staking the screen
 * says so and reads nothing.
 */
@Composable
fun StakingScreen(
    store: WalletStore,
    viewActivity: () -> Unit,
    back: () -> Unit,
) {
    val model = remember { store.makeStakingModel() }
    var action by remember { mutableStateOf<StakingActionModel?>(null) }
    val scope = rememberCoroutineScope()
    if (model == null) {
        LaunchedEffect(Unit) { back() }
        return
    }
    LaunchedEffect(model) { model.load() }
    val current = action
    if (current != null) {
        StakingActionScreen(store, current, viewActivity) {
            action = null
            // The pools and "Your stakes" are read again after an action.
            scope.launch {
                model.validator?.let { model.open(it.staker, it.name) }
                model.loadPositions()
            }
        }
        return
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(StakingCopy.title, network = store.networkLabel) {
            if (model.validator != null) model.closeValidator() else back()
        }
        val unavailable = model.unavailable
        val validator = model.validator
        when {
            unavailable != null -> {
                StatusLine(unavailable)
            }

            validator != null -> {
                ValidatorSection(model, validator) { kind, row, amount ->
                    action = store.makeStakingAction(kind, row, amount, model)
                }
            }

            else -> {
                PositionsSection(model)
                DirectorySection(model)
            }
        }
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** One whole-row button over a validator or a position: name, short address, then its lines. */
@Composable
internal fun StakingCard(
    name: String,
    staker: String,
    lines: List<String>,
    open: () -> Unit,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .fillPress(skin.panel, skin.softPress, panelShape, onClick = open)
            .padding(BrambleSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs)) {
            Text(name, color = skin.text, style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold))
            Text(accountLabel(staker), color = skin.muted, style = textStyle(BrambleTypeScale.mono, mono = true))
            lines.forEach { Text(it, color = skin.muted, style = textStyle(BrambleTypeScale.caption)) }
        }
        BrambleIcon(BrambleIconName.CHEVRON_RIGHT, skin.muted)
    }
}

/** "Your stakes": absent while loading, off, or complete and empty; never "none" when partial. */
@Composable
private fun PositionsSection(model: StakingModel) {
    val scope = rememberCoroutineScope()
    when (val positions = model.positions) {
        is StakingLoad.Failed -> {
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                Eyebrow(StakingCopy.positionsTitle)
                StatusLine(positions.message, StatusTone.DANGER)
            }
        }

        is StakingLoad.Loaded -> {
            val view: StakingView = positions.value
            if (view.complete && view.rows.isEmpty()) return
            Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
                Eyebrow(StakingCopy.positionsTitle)
                view.rows.forEach { row ->
                    val name = model.nameOf(row.staker)
                    StakingCard(
                        name ?: StakingCopy.validatorName,
                        row.staker,
                        positionLines(row, ::coreAmount, ::accountLabel),
                    ) { scope.launch { model.open(row.staker, name) } }
                }
                if (!view.complete) StatusLine(StakingCopy.positionsMayNotBeListed)
            }
        }

        StakingLoad.Loading, StakingLoad.Off -> {
            // Nothing while loading or off: an absent section never reads as "no stakes".
        }
    }
}

/** The directory in whatever state it is in, then the paste field. */
@Composable
private fun DirectorySection(model: StakingModel) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm)) {
        when (val directory = model.directory) {
            StakingLoad.Loading -> {
                StatusLine(StakingCopy.directoryLoading)
            }

            StakingLoad.Off -> {
                // Starkscan is off: the paste field below is the way to a validator.
            }

            is StakingLoad.Failed -> {
                StatusLine(directory.message, StatusTone.DANGER)
            }

            is StakingLoad.Loaded -> {
                val listed = directory.value
                if (listed.incomplete) {
                    StatusLine(StakingCopy.directoryIncomplete, StatusTone.DANGER)
                } else {
                    Text(StakingCopy.directoryListedBy, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
                    if (listed.entries.isEmpty()) StatusLine(StakingCopy.directoryNoValidators)
                    listed.entries.forEach { entry ->
                        val lines =
                            listOf(figuresLine(entry)) + entry.pools.map(::poolLine) + listOfNotNull(entry.website)
                        StakingCard(entry.name ?: StakingCopy.directoryUnnamed, entry.staker, lines) {
                            scope.launch { model.open(entry.staker, entry.name) }
                        }
                    }
                    StatusLine(listed.moreError, StatusTone.DANGER)
                    listed.nextCursor?.let { cursor ->
                        PillButton(StakingCopy.directoryShowMore, kind = PillKind.GHOST, busy = model.loadingMore) {
                            scope.launch { model.loadDirectory(cursor) }
                        }
                    }
                    Text(
                        StakingCopy.directoryNotListed,
                        color = skin.muted,
                        style = textStyle(BrambleTypeScale.caption),
                    )
                }
            }
        }
        org.bramble.wallet.design.BrambleField(
            label = null,
            placeholder = StakingCopy.directoryPasteAddress,
            value = model.pasteInput,
            onValueChange = model::paste,
            kind = SecretKind.ADDRESS,
            invalid = model.pasteError != null,
            spokenLabel = StakingCopy.directoryValidatorAddress,
        )
        StatusLine(model.pasteError, StatusTone.DANGER)
        PillButton(StakingCopy.directoryOpen, kind = PillKind.GHOST) { scope.launch { model.openPasted() } }
    }
}

/** A panel's frame for one staking row. */
@Composable
internal fun RowPanel(
    tag: String,
    content: @Composable () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(LocalSkin.current.panel, panelShape)
            .padding(BrambleSpace.md)
            .semantics { testTag = tag },
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
    ) { content() }
}

/** Closes an unsigned plan when the action's screen leaves. */
@Composable
internal fun CloseOnLeave(model: StakingActionModel) {
    DisposableEffect(model) { onDispose { model.close() } }
}
