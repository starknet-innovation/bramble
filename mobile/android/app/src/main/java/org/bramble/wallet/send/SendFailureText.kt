package org.bramble.wallet.send

import org.bramble.core.SendFailure
import org.bramble.core.SendFailureCode

// The Send journey's text helpers, split from SendFlowModel.kt: the failure wording and the Half
// shortcut's integer halving. Pure functions over core values; no state.

/** The extension's wording per failure code (`SendCopy`, generated). */
object SendFailureText {
    private val reasons: Map<SendFailureCode, String> =
        mapOf(
            SendFailureCode.REVIEWED_FEE_EXCEEDED to SendCopy.reviewedFeeExceeded,
            SendFailureCode.REVIEWED_FEE_REQUIRED to SendCopy.reviewedFeeRequired,
            SendFailureCode.REVIEWED_DEPLOYMENT_FEE_EXCEEDED to SendCopy.reviewedDeploymentFeeExceeded,
            SendFailureCode.REVIEWED_DEPLOYMENT_FEE_REQUIRED to SendCopy.reviewedDeploymentFeeRequired,
            SendFailureCode.POISONED_RECIPIENT to SendCopy.poisonedRecipient,
            SendFailureCode.WRONG_CHAIN to SendCopy.failureWrongChain,
            SendFailureCode.PREPARATION_UNAVAILABLE to SendCopy.failurePreparationUnavailable,
            SendFailureCode.HASH_MISMATCH to SendCopy.failureHashMismatch,
            SendFailureCode.SUBMISSION_INDETERMINATE to SendCopy.failureIndeterminate,
            SendFailureCode.DEPLOYMENT_STATUS_UNKNOWN to SendCopy.failureDeploymentStatusUnknown,
            SendFailureCode.DEPLOYMENT_UNCONFIRMED to SendCopy.failureDeploymentUnconfirmed,
            SendFailureCode.DEPLOYMENT_THEN_INVOKE_UNCONFIRMED to SendCopy.failureDeploymentThenInvokeUnconfirmed,
            SendFailureCode.AUTO_DEPLOYMENT_FAILED to SendCopy.failureAutoDeploymentFailed,
            SendFailureCode.ALREADY_DEPLOYED to SendCopy.failureAlreadyDeployed,
            SendFailureCode.UNRECOGNISED_FEE_UNIT to SendCopy.failureUnrecognisedUnit,
            SendFailureCode.ACCOUNT_CLASS_UNRECOGNISED to SendCopy.failureAccountClassUnrecognised,
            SendFailureCode.ACCOUNT_CLASS_UNSUPPORTED to SendCopy.failureAccountClassUnsupported,
            SendFailureCode.ACCOUNT_NOT_DEPLOYABLE to SendCopy.failureAccountNotDeployable,
            SendFailureCode.ACCOUNT_OWNER_MISMATCH to SendCopy.failureAccountOwnerMismatch,
            SendFailureCode.ACCOUNT_OWNER_TYPE_UNSUPPORTED to SendCopy.failureAccountOwnerTypeUnsupported,
            SendFailureCode.ACCOUNT_GUARDIAN_UNSUPPORTED to SendCopy.failureAccountGuardianUnsupported,
            SendFailureCode.BRAAVOS_DEPLOY_FIRST to SendCopy.failureBraavosDeployFirst,
            SendFailureCode.BRAAVOS_NOT_DEPLOYABLE to SendCopy.failureBraavosNotDeployable,
            SendFailureCode.BRAAVOS_CLASS_UNRECOGNISED to SendCopy.failureBraavosClassUnrecognised,
            SendFailureCode.BRAAVOS_OWNER_MISMATCH to SendCopy.failureBraavosOwnerMismatch,
            SendFailureCode.BRAAVOS_STRONG_SIGNER to SendCopy.failureBraavosStrongSigner,
        )

    /**
     * The failure line for [failure], with its hash and (for a Ready refusal) the account class
     * filled in; the generic line for other codes.
     */
    fun message(failure: SendFailure): String {
        val reason = reasons[failure.code] ?: return SendCopy.failureDefault
        return SendCopy.failurePrefix +
            reason.replace("{hash}", failure.hash ?: "").replace("{label}", failure.detail ?: "")
    }
}

/** Integer halving of a base-10 string (floor), as the extension's `raw / 2n`. */
internal fun halve(decimal: String): String {
    var remainder = 0
    val digits = StringBuilder()
    for (character in decimal) {
        val digit = character.digitToIntOrNull() ?: return "0"
        val current = remainder * DECIMAL_RADIX + digit
        digits.append(current / 2)
        remainder = current % 2
    }
    return digits.trimStart('0').toString().ifEmpty { "0" }
}

private const val DECIMAL_RADIX = 10
