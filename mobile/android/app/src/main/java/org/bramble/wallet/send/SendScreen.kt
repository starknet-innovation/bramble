package org.bramble.wallet.send

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.bramble.core.shortAddress
import org.bramble.wallet.ui.BrambleField
import org.bramble.wallet.ui.Card
import org.bramble.wallet.ui.ErrorText
import org.bramble.wallet.ui.PrimaryButton
import org.bramble.wallet.ui.SecondaryButton

/**
 * The Send journey in Compose, stage for stage with the iOS `SendFlowView` and the extension's
 * `send-views.ts`; all copy comes from the generated `SendCopy`. Not yet routed from Home:
 * the android-parity workstream owns `Screens.kt`, so wiring is one call there,
 * `SendScreen(model, close)`.
 *
 * Uncompiled: this machine has no Android SDK.
 */
@Composable
fun SendScreen(model: SendFlowModel, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    DisposableEffect(model) { onDispose { model.close() } }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(model.title)
        when (model.stage) {
            SendFlowModel.Stage.RECIPIENT -> {
                Text(SendCopy.sendingTo)
                BrambleField(SendCopy.recipientFieldLabel, model.recipientInput, { model.recipientInput = it })
                ErrorText(model.recipientError)
                PrimaryButton(SendCopy.continueWithAddress, enabled = model.recipientInput.isNotBlank()) { model.continueWithRecipient() }
            }
            SendFlowModel.Stage.DETAILS, SendFlowModel.Stage.REVIEWING -> {
                Card {
                    Text("${SendCopy.toLabel} ${model.recipient?.let(::shortAddress) ?: "—"}")
                    Text("${SendCopy.assetLabel} ${model.token.symbol}")
                }
                BrambleField(SendCopy.amountLabel, model.amount, { model.amount = it.replace(',', '.') })
                SecondaryButton(SendCopy.max) { model.fillMax() }
                ErrorText(model.amountError)
                PrimaryButton(SendCopy.reviewLabel, busy = model.stage == SendFlowModel.Stage.REVIEWING) { scope.launch { model.reviewSend() } }
            }
            SendFlowModel.Stage.REVIEW -> model.review?.let { review ->
                Text("${review.amountDisplay} ${review.tokenSymbol}")
                Text("${SendCopy.recipientRowLabel} ${review.recipientShort}")
                val fee = review.fee
                val deployment = review.deploymentFee
                when {
                    review.requiresDeployment && fee != null && deployment != null -> {
                        Text(SendCopy.transactionFeePrefix + fee.display)
                        Text(SendCopy.deploymentFeePrefix + deployment.display)
                    }
                    review.requiresDeployment -> Text(SendCopy.feesFailed)
                    fee != null -> Text(SendCopy.feePrefix + fee.display)
                    else -> Text(SendCopy.feeFailed)
                }
                if (fee == null || (review.requiresDeployment && deployment == null)) {
                    SecondaryButton(SendCopy.retryFee) { scope.launch { model.retryFee() } }
                }
                ErrorText(model.reviewBlock)
                Text(SendCopy.reviewNote)
                PrimaryButton(SendCopy.confirmLabel, enabled = review.canConfirm) { scope.launch { model.confirm() } }
                SecondaryButton(SendCopy.edit) { model.edit() }
            }
            SendFlowModel.Stage.AUTHORIZING -> Text(SendCopy.workingAuthorizingCopy)
            SendFlowModel.Stage.BROADCASTING -> Text(SendCopy.workingBroadcastingCopy)
            SendFlowModel.Stage.CONFIRMING -> Text(SendCopy.workingConfirmingCopy)
            SendFlowModel.Stage.PENDING -> {
                Text(SendCopy.pendingTitle)
                Text(SendCopy.pendingBody)
                model.hash?.let { Text(it) }
                PrimaryButton(SendCopy.checkConfirmation) { scope.launch { model.checkAgain() } }
            }
            SendFlowModel.Stage.SUBMITTED -> {
                Text(SendCopy.successTitle)
                model.hash?.let { Text(it) }
                PrimaryButton(SendCopy.backToHome, onClick = close)
            }
            SendFlowModel.Stage.FAILED -> {
                Text(SendCopy.failureTitle)
                Text(model.failureMessage ?: SendCopy.failureDefault)
                PrimaryButton(SendCopy.tryAgain) { scope.launch { model.reviewSend() } }
                SecondaryButton(SendCopy.editTransaction) { model.edit() }
            }
        }
    }
}
