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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import kotlinx.coroutines.launch
import org.bramble.core.AccountRecord
import org.bramble.wallet.DeployNotice
import org.bramble.wallet.WalletStore
import org.bramble.wallet.deployNotice
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
import org.bramble.wallet.ui.shortAddress

/**
 * `deploy-account` from `flows.ts`, port of the iOS `DeployAccountView`: what will happen, the
 * account receipt, the risk note, then "Review deployment" → "Confirm deployment · <fee>" →
 * "Deployment submitted". Built from the Send screens' receipt and outcome, so both flows share
 * one layout. Every value shown is the core plan's; the plan closes when the screen leaves.
 */
@Composable
fun DeployAccountScreen(
    store: WalletStore,
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
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = BrambleSpace.lg),
        verticalArrangement = Arrangement.spacedBy(BrambleSpace.lg),
    ) {
        FlowHeader(SendCopy.deployTitle, network = store.networkLabel, back = back)
        if (model.stage == DeployFlowModel.Stage.SUBMITTED) {
            Submitted(store, model, back)
        } else {
            DeployForm(store, model, account)
        }
        Spacer(Modifier.height(BrambleSpace.lg))
    }
}

/** The review form: outcome, receipt, risk, the reviewed fee, the failure line and the action. */
@Composable
private fun DeployForm(
    store: WalletStore,
    model: DeployFlowModel,
    account: AccountRecord,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(BrambleSpace.md)) {
        Eyebrow(SendCopy.whatWillHappen)
        Text(SendCopy.deployOutcome, color = skin.text, style = textStyle(BrambleTypeScale.body))
        Receipt(
            listOf(
                SendCopy.deployAccountRow to account.displayName,
                SendCopy.deployAddressRow to shortAddress(account.address),
                SendCopy.deployContractRow to SendCopy.deployContractValue,
                SendCopy.deployNetworkRow to store.networkLabel,
            ),
        )
        Eyebrow(SendCopy.riskAndRecovery)
        Text(SendCopy.deployRisk, color = skin.muted, style = textStyle(BrambleTypeScale.body))
        model.fee?.let { fee ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(skin.panel, panelShape)
                    .padding(horizontal = BrambleSpace.lg, vertical = BrambleSpace.md),
                verticalArrangement = Arrangement.spacedBy(BrambleSpace.sm),
            ) {
                Eyebrow(SendCopy.maximumCost)
                Text(
                    SendCopy.maximumFeePrefix + fee.display,
                    color = skin.text,
                    style = textStyle(BrambleTypeScale.body, BrambleWeight.semibold).copy(fontFeatureSettings = "tnum"),
                )
            }
        }
        StatusLine(model.failureMessage.takeIf { model.stage == DeployFlowModel.Stage.FAILED }, StatusTone.DANGER)
        when (model.stage) {
            DeployFlowModel.Stage.REVIEWED, DeployFlowModel.Stage.SUBMITTING -> {
                PillButton(
                    SendCopy.confirmDeploymentPrefix + model.fee?.display.orEmpty(),
                    icon = BrambleIconName.CHECK,
                    busy = model.stage == DeployFlowModel.Stage.SUBMITTING,
                ) { scope.launch { model.confirm() } }
            }

            DeployFlowModel.Stage.ALREADY_DEPLOYED -> {
                // A status, not an action: the account is already on-chain.
                PillButton(SendCopy.alreadyDeployed, icon = BrambleIconName.CHECK, enabled = false) {}
            }

            else -> {
                PillButton(
                    SendCopy.reviewDeployment,
                    icon = BrambleIconName.CHECK,
                    busy = model.stage == DeployFlowModel.Stage.REVIEWING,
                ) { scope.launch { model.review() } }
            }
        }
    }
}

/** "Deployment submitted", with the hash; Back to home re-reads balances and deployment. */
@Composable
private fun Submitted(
    store: WalletStore,
    model: DeployFlowModel,
    back: () -> Unit,
) {
    Outcome(
        BrambleIconName.CHECK,
        LocalSkin.current.positive,
        OutcomeCopy(SendCopy.deploySuccessKicker, SendCopy.deploySuccessTitle, SendCopy.deploySuccessBody),
        model.hash,
    ) {
        PillButton(SendCopy.backToHome, icon = BrambleIconName.HOME) {
            store.appScope.launch { store.refreshBalances() }
            back()
        }
    }
}

/**
 * Home's `deployNotice` ([deployNotice]): shown only when the core judged the account undeployed.
 * With a STRK balance read as zero it asks for funding and opens Receive; otherwise it opens the
 * Deploy account flow. The extension's chip explains itself in a tooltip; here the explanation is
 * the control's state description, read after its label.
 */
@Composable
fun DeployNoticeChip(
    store: WalletStore,
    receive: () -> Unit,
    deploy: () -> Unit,
) {
    val notice = store.deployNotice
    if (notice == DeployNotice.HIDDEN) return
    val unfunded = notice == DeployNotice.FUND
    val explanation = if (unfunded) SendCopy.fundChipTitle else SendCopy.deployChipTitle
    PillButton(
        if (unfunded) SendCopy.fundChip else SendCopy.deployChip,
        modifier = Modifier.semantics { stateDescription = explanation },
        kind = PillKind.SECONDARY,
        icon = if (unfunded) BrambleIconName.QR_CODE else BrambleIconName.ROCKET,
        onClick = if (unfunded) receive else deploy,
    )
}
