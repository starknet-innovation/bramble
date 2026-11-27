package org.bramble.wallet.coordination

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.launch
import org.bramble.core.MultisigRecord
import org.bramble.core.formatTokenAmount
import org.bramble.wallet.WalletStore
import org.bramble.wallet.design.BrambleLayout
import org.bramble.wallet.design.BrambleSize
import org.bramble.wallet.design.BrambleSpace
import org.bramble.wallet.design.BrambleTypeScale
import org.bramble.wallet.design.BrambleWeight
import org.bramble.wallet.design.LocalSkin
import org.bramble.wallet.design.MenuDivider
import org.bramble.wallet.design.MenuGroup
import org.bramble.wallet.design.PillButton
import org.bramble.wallet.design.StatusLine
import org.bramble.wallet.design.capsule
import org.bramble.wallet.design.textStyle
import org.bramble.wallet.ui.shortAddress

// The create flow's progress and its last two stages, port of iOS `CoordinationControls.swift`
// (`StepProgress`) and `MultisigSetupStages.swift`.

/** Fraction digits shown for the funding balance. */
private const val FUNDING_FRACTION_DIGITS: UByte = 4u

private const val DEPLOY_UNAVAILABLE =
    "Deployment from mobile arrives with sending. Deploy this saved setup from Bramble for browser, " +
        "or come back after the update."

/** `.multisig-deploy-progress`: numbered steps; the active one on accent, finished ones positive. */
@Composable
internal fun StepProgress(
    steps: List<String>,
    active: Int,
) {
    val skin = LocalSkin.current
    Box(Modifier.fillMaxWidth().semantics { contentDescription = "Multisig creation progress" }) {
        // The connector runs through the disc centres, behind the discs.
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = BrambleLayout.stepDisc / 2, start = BrambleSpace.xl, end = BrambleSpace.xl)
                .height(BrambleLayout.hairline)
                .background(skin.hairline),
        )
        Row(Modifier.fillMaxWidth()) {
            steps.forEachIndexed { index, label ->
                val (ink, fill) =
                    when {
                        index == active -> skin.accentText to skin.accent
                        index < active -> skin.positive to skin.positiveSoft
                        else -> skin.muted to skin.elevated
                    }
                Column(
                    Modifier.weight(1f).semantics(mergeDescendants = true) { selected = index == active },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(BrambleSpace.xs),
                ) {
                    Box(
                        Modifier.size(BrambleLayout.stepDisc).background(fill, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "${index + 1}",
                            color = ink,
                            style = textStyle(BrambleTypeScale.micro, BrambleWeight.semibold),
                        )
                    }
                    Text(
                        label,
                        color = if (index == active) skin.text else skin.muted,
                        style = textStyle(BrambleTypeScale.micro),
                    )
                }
            }
        }
    }
}

/**
 * `deploymentFundingStage`: the saved counterfactual address to fund, as a QR and a copyable line,
 * and a balance check. The extension quotes the DEPLOY_ACCOUNT fee and can fund from this wallet;
 * both need the transactions workstream's estimate and Send, so mobile names the token instead of
 * an amount and omits "Fund from this wallet".
 */
@Composable
internal fun MultisigFundStage(
    store: WalletStore,
    record: MultisigRecord?,
    next: () -> Unit,
) {
    val skin = LocalSkin.current
    val scope = rememberCoroutineScope()
    var balance by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "Fund this multisig",
            color = skin.text,
            style = textStyle(BrambleTypeScale.title, BrambleWeight.bold),
            modifier = Modifier.weight(1f),
        )
        Box(
            Modifier
                .heightIn(min = BrambleSize.pill)
                .background(skin.elevated, capsule)
                .padding(horizontal = BrambleSpace.sm),
            contentAlignment = Alignment.Center,
        ) { Text("STRK", color = skin.text, style = textStyle(BrambleTypeScale.label, BrambleWeight.semibold)) }
    }
    Caption("Send STRK to this saved address to pay for deployment. You can close this screen and resume safely.")
    record?.address?.let { address ->
        FundingAddress(store, address, "Copy multisig funding address", "Multisig funding address")
        PillButton("Check funding", kind = org.bramble.wallet.design.PillKind.SECONDARY, busy = checking) {
            scope.launch {
                checking = true
                balance = fundingBalance(store, address)
                checking = false
            }
        }
        StatusLine(balance)
    }
    PillButton("Continue to deploy", onClick = next)
}

/** "Balance: N STRK" for [address], or the retry line when the read fails. */
private suspend fun fundingBalance(
    store: WalletStore,
    address: String,
): String {
    val strk = store.networkInfo.tokens.firstOrNull { it.symbol == "STRK" }
    val raw = runCatching { store.rpc.balances(address, store.networkInfo)["STRK"] }.getOrNull()
    val amount =
        if (strk == null || raw == null) {
            null
        } else {
            runCatching { formatTokenAmount(raw, strk.decimals, FUNDING_FRACTION_DIGITS) }.getOrNull()
        }
    return amount?.let { "Balance: $it STRK" } ?: "Balance could not be checked. Try again shortly."
}

/**
 * The frozen deployment review (address, threshold, signers, salt). Deploying from mobile
 * arrives with sending; the button stays disabled and says so.
 */
@Composable
internal fun MultisigDeployStage(record: MultisigRecord?) {
    record?.deployment?.let { deployment ->
        MenuGroup {
            ReviewRow("Address", shortAddress(deployment.address))
            MenuDivider()
            ReviewRow("Required", "${deployment.config.threshold} of ${deployment.config.signerPublicKeys.size}")
            deployment.config.signerPublicKeys.forEachIndexed { index, key ->
                MenuDivider()
                ReviewRow("Signer ${index + 1}", shortAddress(key))
            }
            MenuDivider()
            ReviewRow("Salt", deployment.salt)
        }
    }
    PillButton("Deploy multisig", enabled = false) {
        // No action: deployment from mobile is not available yet, so the button stays disabled.
    }
    Caption(DEPLOY_UNAVAILABLE)
}

@Composable
private fun ReviewRow(
    label: String,
    value: String,
) {
    val skin = LocalSkin.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = BrambleLayout.reviewRowMin)
            .padding(horizontal = BrambleSpace.lg)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = skin.muted, style = textStyle(BrambleTypeScale.body), modifier = Modifier.weight(1f))
        Text(value, color = skin.text, style = textStyle(BrambleTypeScale.body, mono = true))
    }
}
