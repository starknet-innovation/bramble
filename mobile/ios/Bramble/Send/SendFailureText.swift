import BrambleCore

/// The extension's wording for each way a send can end without a confirmed transaction
/// (`SendCopy`, generated from the extension). Node text is never shown.
enum SendFailureText {
    /// The failure screen's body: "The transaction was not sent. <reason>". `{hash}` is the
    /// failure's hash and `{label}` the account class a Ready refusal names.
    static func message(_ failure: SendFailure) -> String {
        guard let reason = reason(failure.code) else { return SendCopy.failureDefault }
        return SendCopy.failurePrefix + reason
            .replacingOccurrences(of: "{hash}", with: failure.hash ?? "")
            .replacingOccurrences(of: "{label}", with: failure.detail ?? "")
    }

    static func reason(_ code: SendFailureCode) -> String? {
        switch code {
        case .reviewedFeeExceeded:
            SendCopy.reviewedFeeExceeded

        case .reviewedFeeRequired:
            SendCopy.reviewedFeeRequired

        case .reviewedDeploymentFeeExceeded:
            SendCopy.reviewedDeploymentFeeExceeded

        case .reviewedDeploymentFeeRequired:
            SendCopy.reviewedDeploymentFeeRequired

        case .poisonedRecipient:
            SendCopy.poisonedRecipient

        case .wrongChain:
            SendCopy.failureWrongChain

        case .preparationUnavailable:
            SendCopy.failurePreparationUnavailable

        case .hashMismatch:
            SendCopy.failureHashMismatch

        case .submissionIndeterminate:
            SendCopy.failureIndeterminate

        case .deploymentStatusUnknown:
            SendCopy.failureDeploymentStatusUnknown

        case .deploymentUnconfirmed:
            SendCopy.failureDeploymentUnconfirmed

        case .deploymentThenInvokeUnconfirmed:
            SendCopy.failureDeploymentThenInvokeUnconfirmed

        case .autoDeploymentFailed:
            SendCopy.failureAutoDeploymentFailed

        case .alreadyDeployed:
            SendCopy.failureAlreadyDeployed

        case .unrecognisedFeeUnit:
            SendCopy.failureUnrecognisedUnit

        case .accountClassUnrecognised:
            SendCopy.failureAccountClassUnrecognised

        case .accountClassUnsupported:
            SendCopy.failureAccountClassUnsupported

        case .accountNotDeployable:
            SendCopy.failureAccountNotDeployable

        case .accountOwnerMismatch:
            SendCopy.failureAccountOwnerMismatch

        case .accountOwnerTypeUnsupported:
            SendCopy.failureAccountOwnerTypeUnsupported

        case .accountGuardianUnsupported:
            SendCopy.failureAccountGuardianUnsupported

        case .braavosDeployFirst:
            SendCopy.failureBraavosDeployFirst

        case .braavosNotDeployable:
            SendCopy.failureBraavosNotDeployable

        case .braavosClassUnrecognised:
            SendCopy.failureBraavosClassUnrecognised

        case .braavosOwnerMismatch:
            SendCopy.failureBraavosOwnerMismatch

        case .braavosStrongSigner:
            SendCopy.failureBraavosStrongSigner

        case .boundsOutOfRange, .nodeError, .locked, .signingFailed:
            nil
        }
    }

    /// Whether the failure left something on chain the user must check before retrying.
    static func mayHaveReachedChain(_ code: SendFailureCode) -> Bool {
        switch code {
        case .hashMismatch, .submissionIndeterminate, .deploymentStatusUnknown:
            true

        case .deploymentUnconfirmed, .deploymentThenInvokeUnconfirmed:
            true

        default:
            false
        }
    }
}
