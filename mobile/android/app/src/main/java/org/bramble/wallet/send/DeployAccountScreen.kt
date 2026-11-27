package org.bramble.wallet.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.bramble.core.AccountRecord
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleIconName
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.Eyebrow
import org.bramble.wallet.design.FlowHeader
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.PillKind
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.StatusTone
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.makeDeployModel
import org.bramble.wallet.refreshBalances
import org.bramble.wallet.ui.CopyButton
import org.bramble.wallet.ui.shortAddress

/**
 * `deploy-account` from `flows.ts` with the extension's `bindDeploy`, port of the iOS
 * `DeployAccountView`: the account, address and network, the fee quoted as the screen opens, one
 * Deploy button, then the receipt ("Deployment submitted", firming up to "Account deployed").
 * Opened from Settings' "This account"; [viewActivity] leaves every flow for the Activity tab.
 * Built from the Send screens' receipt and outcome, so both flows share one layout. Every value
 * shown is the core plan's; the plan closes when the screen leaves.
 */
@Composable
fun DeployAccountScreen(
    store: WalletStore,
    viewActivity: () -> Unit,
    back: () -> Unit,
) {
    val model = remember { store.makeDeployModel() }
    val account = store.activeRecord
    if (model == null || account == null) {
        // Locked, or an account the core builds no deployment for: nothing to show.
        LaunchedEffect(Unit) { back() }
        return
    }
    DisposableEffect(model) { onDispose { model.close() } }
    LaunchedEffect(model) { model.open(store.deployment) }
    // Leaving re-reads balances and deployment, so Settings and the privacy gates see the result.
    val leave = { exit: () -> Unit ->
        store.appScope.launch { store.refreshBalances() }
        exit()
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(SendCopy.deployTitle, network = store.networkLabel, back = { leave(back) })
        if (model.stage == DeployFlowModel.Stage.SUBMITTED) {
            Submitted(store, model, viewActivity = { leave(viewActivity) }, back = { leave(back) })
        } else {
            DeployForm(store, model, account)
        }
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** The account receipt, the Cost box with the quoted fee (or why there is none), and Deploy. */
@Composable
private fun DeployForm(
    store: WalletStore,
    model: DeployFlowModel,
    account: AccountRecord,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    val view = deployView(model.stage, model.fee, model.problem)
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Receipt(
            listOf(
                SendCopy.deployAccountRow to account.displayName,
                SendCopy.deployAddressRow to shortAddress(account.address),
                SendCopy.deployNetworkRow to store.networkLabel,
            ),
        ) { index -> if (index == ADDRESS_ROW) CopyButton(store, account.address, COPY_ADDRESS) }
        view.cost?.let { cost ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(skin.panel, panelShape)
                    .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.md),
                verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            ) {
                Eyebrow(SendCopy.cost)
                Text(
                    cost,
                    color = if (view.costFailed) skin.danger else skin.text,
                    style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold).copy(fontFeatureSettings = "tnum"),
                )
            }
        }
        if (model.stage != DeployFlowModel.Stage.ALREADY_DEPLOYED) {
            // Deploying by hand is optional: the first send deploys too (issue 662).
            Text(SendCopy.deployNote, color = skin.muted, style = textStyle(BrambleTypeScale.caption))
        }
        PillButton(
            view.button,
            icon = BrambleIconName.CHECK,
            busy = view.busy,
            enabled = view.enabled,
        ) { scope.launch { model.deploy() } }
        StatusLine(view.status)
    }
}

/** The receipt: the chain's answer so far, the hash, then View in Activity tab and Back. */
@Composable
private fun Submitted(
    store: WalletStore,
    model: DeployFlowModel,
    viewActivity: () -> Unit,
    back: () -> Unit,
) {
    val (title, body) = deployReceipt(model.confirmed)
    Outcome(
        BrambleIconName.CHECK,
        LocalSkin.current.positive,
        title,
        message = body,
        detail = {
            ReceiptCard(store, summary = null, hash = model.hash)
            StatusLine(model.problem, StatusTone.DANGER)
        },
    ) {
        PillButton(SendCopy.viewActivity, icon = BrambleIconName.ACTIVITY, onClick = viewActivity)
        PillButton(SendCopy.back, kind = PillKind.SECONDARY, onClick = back)
    }
}

/** The receipt row whose value is the address, which carries the copy control. */
private const val ADDRESS_ROW = 1

/** The address row's copy control, as the extension's receipt action. */
private const val COPY_ADDRESS = "Copy address"
